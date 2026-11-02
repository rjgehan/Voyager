package com.rjgehan.notes.index;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Stream;

import com.rjgehan.notes.config.NotesProperties;
import com.rjgehan.notes.vault.PathNames;
import com.rjgehan.notes.vault.VaultFs;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Makes the text of PDF attachments searchable (DESIGN §5.5.10), never on a request thread: the index tells it about
 * every PDF that appears or changes ({@link VaultIndex.ExtractionListener}), and one background thread extracts the
 * text with {@link PdfText} within the {@code notes.search.pdf} limits, then swaps it into the index. Each result is
 * cached in {@code .notesapp/cache/search-text/} (outside git), keyed by the file's path, size and mtime, so a
 * restart re-extracts nothing; a moved PDF takes its cache entry along. Once the backlog of the first pass is done,
 * cache entries of files that no longer exist are deleted. A PDF that cannot be read (encrypted, damaged, too large,
 * too slow, or one whose reading stopped the server) is indexed by its name alone.
 */
@Component
public class PdfTextIndexer implements SmartLifecycle, VaultIndex.ExtractionListener {

	private static final Logger logger = LoggerFactory.getLogger(PdfTextIndexer.class);

	/** Where extracted text is cached, relative to the vault. */
	public static final String CACHE_DIR = ".notesapp/cache/search-text";

	/** Appended to a cache entry's name while its text is being extracted (see {@link #extractOnce}). */
	static final String INFLIGHT_SUFFIX = ".reading";

	private record Move(FileRecord from, FileRecord to) {
	}

	private final VaultIndex index;

	private final VaultFs fs;

	private final NotesProperties.Pdf limits;

	private final Object monitor = new Object();

	private final LinkedHashSet<String> pending = new LinkedHashSet<>();

	private final ArrayDeque<Move> moves = new ArrayDeque<>();

	private volatile @Nullable ExecutorService extractor;

	private volatile @Nullable Thread worker;

	private volatile boolean running;

	private volatile boolean busy;

	private boolean cleaned;

	public PdfTextIndexer(VaultIndex index, VaultFs fs, NotesProperties properties) {
		this.index = index;
		this.fs = fs;
		this.limits = properties.search().pdf();
		if (this.limits.enabled()) {
			index.setExtractionListener(this);
		}
	}

	// ---------------------------------------------------------------- listener (under the index write lock)

	@Override
	public void extractable(FileRecord record) {
		synchronized (this.monitor) {
			this.pending.add(record.path());
			this.monitor.notifyAll();
		}
	}

	@Override
	public void moved(FileRecord from, FileRecord to) {
		synchronized (this.monitor) {
			// Queued whether or not the old path still waits: the worker may be extracting it right now, and its text
			// is then refused for the old path. The new path is skipped if its text moved with it.
			this.pending.remove(from.path());
			this.pending.add(to.path());
			this.moves.add(new Move(from, to));
			this.monitor.notifyAll();
		}
	}

	// ---------------------------------------------------------------- lifecycle

	@Override
	public void start() {
		if (!this.limits.enabled() || this.running) {
			return;
		}
		this.running = true;
		this.extractor = newExtractor();
		Thread thread = new Thread(this::run, "pdf-text");
		thread.setDaemon(true);
		thread.setPriority(Thread.MIN_PRIORITY);
		this.worker = thread;
		thread.start();
	}

	@Override
	public void stop() {
		this.running = false;
		Thread thread = this.worker;
		if (thread != null) {
			thread.interrupt();
		}
		ExecutorService executor = this.extractor;
		if (executor != null) {
			executor.shutdownNow();
		}
	}

	@Override
	public boolean isRunning() {
		return this.running;
	}

	/** True while files wait for extraction or one is being extracted (tests). */
	public boolean isBusy() {
		synchronized (this.monitor) {
			return this.busy || !this.pending.isEmpty() || !this.moves.isEmpty();
		}
	}

	private static ExecutorService newExtractor() {
		return Executors.newSingleThreadExecutor((task) -> {
			Thread thread = new Thread(task, "pdf-text-extract");
			thread.setDaemon(true);
			thread.setPriority(Thread.MIN_PRIORITY);
			return thread;
		});
	}

	// ---------------------------------------------------------------- worker

	private void run() {
		while (this.running) {
			Move move = null;
			String path = null;
			synchronized (this.monitor) {
				while (this.running && this.pending.isEmpty() && this.moves.isEmpty()) {
					this.busy = false;
					if (!this.cleaned) {
						break;
					}
					try {
						this.monitor.wait();
					}
					catch (InterruptedException ex) {
						return;
					}
				}
				if (!this.running) {
					return;
				}
				if (!this.moves.isEmpty()) {
					move = this.moves.poll();
				}
				else if (!this.pending.isEmpty()) {
					path = this.pending.iterator().next();
					this.pending.remove(path);
				}
				this.busy = move != null || path != null;
			}
			try {
				if (move != null) {
					renameCache(move);
				}
				else if (path != null) {
					process(path);
				}
				else {
					// The backlog of the first pass is done.
					this.cleaned = true;
					removeStaleCache();
				}
			}
			catch (RuntimeException ex) {
				logger.warn("PDF text indexing failed for {}: {}", path, ex.toString());
			}
		}
	}

	private void process(String path) {
		FileRecord record = this.index.file(path);
		if (record == null || !VaultIndex.isExtractable(record) || this.index.hasExtracted(path)) {
			return;
		}
		String text = cached(record);
		if (text == null) {
			text = extractOnce(record);
			if (text == null) {
				return;
			}
		}
		String basename = PathNames.basenameOf(PathNames.nameOf(path));
		NoteParse parse = parseOf(text);
		SearchIndex.Doc doc = SearchIndex.Doc.of(basename, text, parse);
		this.index.putExtracted(record, text, parse, doc);
	}

	/**
	 * Extracts and caches a file's text, guarded against a PDF that takes the server down: a crafted file of a few
	 * hundred kilobytes can make PDFBox inflate a single string of a gigabyte, and the JVM exits on the
	 * {@code OutOfMemoryError} (DESIGN §7.1). Without a guard every start would read the same file again and die again.
	 * So a marker is written next to the cache entry before the extraction and removed after it; a marker found at
	 * the next start means the extraction never finished, and that file is indexed by its name only (security audit,
	 * docs/SECURITY.md F3). Null when the server is stopping: nothing is cached, and the next start tries again.
	 */
	private @Nullable String extractOnce(FileRecord record) {
		Path marker = cacheDir().resolve(cacheName(record) + INFLIGHT_SUFFIX);
		if (Files.exists(marker, LinkOption.NOFOLLOW_LINKS)) {
			logger.warn("PDF {}: reading its text stopped the server last time; it is indexed by its name only",
					record.path());
			writeCache(record, "");
			deleteQuietly(marker);
			return "";
		}
		boolean marked = writeMarker(marker);
		String text = extract(record);
		if (!this.running) {
			if (marked) {
				deleteQuietly(marker);
			}
			return null;
		}
		writeCache(record, text);
		if (marked) {
			deleteQuietly(marker);
		}
		return text;
	}

	private boolean writeMarker(Path marker) {
		try {
			Files.createDirectories(marker.getParent());
			Files.write(marker, new byte[0]);
			return true;
		}
		catch (IOException ex) {
			logger.debug("Cannot mark the PDF text extraction of {} as started: {}", marker, ex.toString());
			return false;
		}
	}

	private static void deleteQuietly(Path file) {
		try {
			Files.deleteIfExists(file);
		}
		catch (IOException ex) {
			logger.debug("Cannot delete {}: {}", file, ex.toString());
		}
	}

	/** The parse of extracted text: its lines and nothing else (no frontmatter, links or tags). */
	static NoteParse parseOf(String text) {
		return new NoteParse(null, null, List.of(), List.of(), List.of(), List.of(), List.of(),
				MarkdownScanner.lineStarts(text), List.of(), List.of(), false, false);
	}

	/** Extracts the text on the extractor thread, waiting at most the time limit; "" when it cannot be read. */
	private String extract(FileRecord record) {
		String disk = this.index.diskPath(record.path());
		Path file = this.fs.resolve((disk != null) ? disk : record.path());
		BasicFileAttributes attributes = VaultFs.attributes(file);
		if (attributes == null || !attributes.isRegularFile()) {
			return "";
		}
		if (attributes.size() > this.limits.maxSize().toBytes()) {
			logger.info("PDF {} is larger than {}; indexed by name only", record.path(), this.limits.maxSize());
			return "";
		}
		Duration timeout = this.limits.timeout();
		long deadline = System.nanoTime() + timeout.toNanos();
		ExecutorService executor = this.extractor;
		if (executor == null) {
			return "";
		}
		long started = System.nanoTime();
		Future<PdfText.Result> future = executor
			.submit(() -> PdfText.extract(file, this.limits.maxPages(), this.limits.maxChars(), deadline));
		try {
			// A page cannot be interrupted, so allow it some time after the deadline before giving up on it.
			PdfText.Result result = future.get(timeout.toMillis() + 10_000, TimeUnit.MILLISECONDS);
			logger.info("PDF text of {}: {} pages, {} characters in {} ms{}", record.path(), result.pages(),
					result.text().length(), (System.nanoTime() - started) / 1_000_000,
					result.truncated() ? " (cut short by a limit)" : "");
			return result.text();
		}
		catch (TimeoutException ex) {
			future.cancel(true);
			// The stuck thread is abandoned (it is a low-priority daemon); later files get a fresh one.
			executor.shutdownNow();
			this.extractor = this.running ? newExtractor() : null;
			logger.warn("PDF text extraction of {} took longer than {}; indexed by name only", record.path(),
					timeout);
			return "";
		}
		catch (ExecutionException ex) {
			Throwable cause = ex.getCause();
			logger.warn("Cannot read the text of PDF {}: {}", record.path(),
					(cause instanceof PdfText.EncryptedException) ? "it is encrypted" : String.valueOf(cause));
			return "";
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			return "";
		}
		catch (java.util.concurrent.RejectedExecutionException ex) {
			return "";
		}
	}

	// ---------------------------------------------------------------- cache

	/** The cache file name of a file's text: a hash of its path, its size and its mtime. */
	static String cacheName(FileRecord record) {
		return sha1(record.path()) + "-" + record.size() + "-" + record.mtime().toEpochMilli() + ".txt";
	}

	private Path cacheDir() {
		return this.fs.resolve(CACHE_DIR);
	}

	private @Nullable String cached(FileRecord record) {
		try {
			return Files.readString(cacheDir().resolve(cacheName(record)), StandardCharsets.UTF_8);
		}
		catch (NoSuchFileException ex) {
			return null;
		}
		catch (IOException ex) {
			logger.warn("Cannot read cached PDF text of {}: {}", record.path(), ex.toString());
			return null;
		}
	}

	private void writeCache(FileRecord record, String text) {
		try {
			Path dir = cacheDir();
			Files.createDirectories(dir);
			Path target = dir.resolve(cacheName(record));
			Path temp = dir.resolve("." + UUID.randomUUID() + ".tmp");
			Files.writeString(temp, text, StandardCharsets.UTF_8);
			try {
				Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
			}
			catch (AtomicMoveNotSupportedException ex) {
				Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
			}
		}
		catch (IOException ex) {
			logger.warn("Cannot cache the PDF text of {}: {}", record.path(), ex.toString());
		}
	}

	private void renameCache(Move move) {
		Path dir = cacheDir();
		Path from = dir.resolve(cacheName(move.from()));
		if (!Files.isRegularFile(from)) {
			return;
		}
		try {
			Files.move(from, dir.resolve(cacheName(move.to())), StandardCopyOption.REPLACE_EXISTING);
		}
		catch (IOException ex) {
			logger.debug("Cannot rename cached PDF text {}: {}", from, ex.toString());
		}
	}

	/** Deletes cache entries that belong to no indexed PDF (deleted, changed or renamed while stopped). */
	private void removeStaleCache() {
		Path dir = cacheDir();
		if (!Files.isDirectory(dir)) {
			return;
		}
		Set<String> wanted = new HashSet<>();
		for (FileRecord record : this.index.files(VaultIndex::isExtractable)) {
			wanted.add(cacheName(record));
		}
		int removed = 0;
		try (Stream<Path> entries = Files.list(dir)) {
			for (Path entry : entries.toList()) {
				if (!wanted.contains(entry.getFileName().toString())) {
					Files.deleteIfExists(entry);
					removed++;
				}
			}
		}
		catch (IOException ex) {
			logger.warn("Cannot clean the PDF text cache: {}", ex.toString());
		}
		if (removed > 0) {
			logger.info("Removed {} stale PDF text cache entries", removed);
		}
	}

	private static String sha1(String value) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-1").digest(value.getBytes(StandardCharsets.UTF_8));
			return java.util.HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

}

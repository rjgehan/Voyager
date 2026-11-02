package com.rjgehan.notes.startup;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import com.rjgehan.notes.bookmarks.BookmarkService;
import com.rjgehan.notes.config.NotesProperties;
import com.rjgehan.notes.history.GitBootstrap;
import com.rjgehan.notes.history.GitStore;
import com.rjgehan.notes.index.IndexBuilder;
import com.rjgehan.notes.index.VaultWalk;
import com.rjgehan.notes.settings.SettingsService;
import com.rjgehan.notes.vault.VaultFs;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * The ordered startup sequence (DESIGN §5.17), run synchronously before Tomcat starts listening, so the port stays
 * closed until the index is ready:
 * <ol>
 * <li>prepare the vault and empty {@code .notesapp/tmp};</li>
 * <li>outside the dev profile, the kernel-mode Tailscale and Host allowlist checks;</li>
 * <li>load the settings, and turn the saved searches of an earlier build into search bookmarks;</li>
 * <li>open or initialize the git repository;</li>
 * <li>write {@code Welcome.md} on a first run;</li>
 * <li>build the index, then write the large-file section of {@code info/exclude} from it.</li>
 * </ol>
 * The watcher and the commit batcher then start as lifecycle beans, and the git bootstrap commit runs after readiness.
 */
@Component
public class VaultStartup implements SmartInitializingSingleton {

	private static final Logger logger = LoggerFactory.getLogger(VaultStartup.class);

	private final NotesProperties properties;

	private final Environment environment;

	private final VaultFs fs;

	private final TailscaleInterfaceCheck tailscaleCheck;

	private final SettingsService settings;

	private final BookmarkService bookmarks;

	private final GitStore git;

	private final WelcomeContent welcome;

	private final IndexBuilder indexBuilder;

	private final GitBootstrap gitBootstrap;

	public VaultStartup(NotesProperties properties, Environment environment, VaultFs fs,
			TailscaleInterfaceCheck tailscaleCheck, SettingsService settings, BookmarkService bookmarks, GitStore git,
			WelcomeContent welcome, IndexBuilder indexBuilder, GitBootstrap gitBootstrap) {
		this.properties = properties;
		this.environment = environment;
		this.fs = fs;
		this.tailscaleCheck = tailscaleCheck;
		this.settings = settings;
		this.bookmarks = bookmarks;
		this.git = git;
		this.welcome = welcome;
		this.indexBuilder = indexBuilder;
		this.gitBootstrap = gitBootstrap;
	}

	@Override
	public void afterSingletonsInstantiated() {
		try {
			boolean emptyDirectory = prepareVault();
			checkDeployment();
			this.settings.load();
			this.bookmarks.migrateSavedSearches();
			this.git.openOrInit();
			boolean firstRun = isFirstRun(emptyDirectory);
			boolean noVisibleFiles = firstRun && VaultWalk.walk(this.fs, "", "").files().isEmpty();
			if (noVisibleFiles && this.properties.welcomeNote()) {
				writeWelcome();
			}
			this.indexBuilder.build();
			this.git.syncLargeFiles();
			this.gitBootstrap.setFreshVault(noVisibleFiles);
		}
		catch (IOException ex) {
			throw new UncheckedIOException("Cannot start on vault " + this.fs.root() + ": " + ex.getMessage(), ex);
		}
	}

	/**
	 * Step 1: the vault exists and is writable, and {@code .notesapp/tmp} is empty. Returns true when the vault folder
	 * had no entries at all before this step.
	 */
	private boolean prepareVault() throws IOException {
		Path root = this.fs.root();
		Files.createDirectories(root);
		if (!Files.isDirectory(root) || !Files.isWritable(root)) {
			throw new IOException("The vault directory is not a writable directory");
		}
		boolean empty;
		try (Stream<Path> entries = Files.list(root)) {
			empty = entries.findAny().isEmpty();
		}
		this.fs.prepareTmp();
		logger.info("Vault: {}", root);
		return empty;
	}

	/** Step 2: outside the dev profile, a kernel-mode Tailscale interface and a non-empty Host allowlist. */
	private void checkDeployment() {
		if (this.environment.matchesProfiles("dev")) {
			return;
		}
		this.tailscaleCheck.check();
		if (this.properties.allowedHosts().isEmpty()) {
			throw new IllegalStateException(
					"notes.allowed-hosts (NOTES_ALLOWED_HOSTS) must list the host names the app answers to");
		}
		if (this.properties.vaults().isDefault()) {
			identityWarnings(this.properties.identity()).forEach(logger::warn);
		}
	}

	/**
	 * What is too open about the identity configuration outside the dev profile (docs/SECURITY.md §7.2): it is not
	 * refused, since a single-user tailnet behind the main layout is safe with it, but it is said once at startup.
	 */
	static java.util.List<String> identityWarnings(NotesProperties.Identity identity) {
		if (identity.allowDefault()) {
			return java.util.List.of("notes.identity.allow-default is on outside the dev profile: a request without "
					+ "Tailscale identity headers is admitted as " + identity.defaultLogin() + ", so anything that "
					+ "reaches the app's port gets in. It is meant for development only");
		}
		if (identity.allowedLogins().isEmpty()) {
			return java.util.List.of("NOTES_IDENTITY_ALLOWED_LOGINS is empty: every Tailscale identity that reaches "
					+ "the app (any member of the tailnet, and users the node is shared with) can read and change "
					+ "every vault. Set it to your own login (docs/SECURITY.md, Hardening advice)");
		}
		return java.util.List.of();
	}

	/**
	 * A first run has a repository created in this boot (or one without commits). With history disabled by
	 * configuration there is no repository to tell, so the vault folder having been empty decides. A user who later
	 * deletes everything therefore never gets the welcome note back.
	 */
	private boolean isFirstRun(boolean emptyDirectory) throws IOException {
		if (this.git.isDisabledByConfiguration()) {
			return emptyDirectory;
		}
		return this.git.createdThisBoot() || !this.git.hasCommits();
	}

	/** Step 5. */
	private void writeWelcome() throws IOException {
		try {
			this.fs.createExclusive(WelcomeContent.FILE_NAME, this.welcome.bytes());
			logger.info("Wrote {} for the first run", WelcomeContent.FILE_NAME);
		}
		catch (FileAlreadyExistsException ex) {
			logger.debug("{} already exists", WelcomeContent.FILE_NAME);
		}
	}

}

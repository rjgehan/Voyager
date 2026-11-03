package com.rjgehan.notes.share;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.rjgehan.notes.api.dto.CreateShareRequest;
import com.rjgehan.notes.api.dto.EntryType;
import com.rjgehan.notes.api.dto.GuestShareResponse;
import com.rjgehan.notes.api.dto.OnConflict;
import com.rjgehan.notes.api.dto.ShareInfo;
import com.rjgehan.notes.api.dto.ShareKind;
import com.rjgehan.notes.api.dto.ShareLinkAction;
import com.rjgehan.notes.api.dto.ShareMode;
import com.rjgehan.notes.api.dto.ShareResult;
import com.rjgehan.notes.api.dto.ShareState;
import com.rjgehan.notes.api.dto.UpdateShareRequest;
import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.events.SharesChangedEvent;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.support.TestVault;
import com.rjgehan.notes.vault.TextCodec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Shares (ROADMAP item 43, DESIGN §5.40): the file and its hashed links, validation, updates and revocation, moves,
 * hand edits, the states, the embedded media of a share and the check of the embeds a guest adds.
 */
class ShareServiceTest {

	private static final Identity OWNER = TestVault.ALICE;

	private static final byte[] PNG = { (byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 1, 2, 3 };

	@TempDir
	Path dir;

	private TestVault vault;

	@AfterEach
	void tearDown() {
		if (this.vault != null) {
			this.vault.close();
		}
	}

	private TestVault start() throws IOException {
		this.vault = TestVault.start(this.dir, Map.of("notes.identity.allowed-logins", OWNER.login()));
		return this.vault;
	}

	private void note(String path, String content) throws IOException {
		this.vault.files.createText(path, content, OnConflict.FAIL, OWNER, null);
	}

	private void image(String path) throws IOException {
		Path file = this.dir.resolve(path);
		Files.createDirectories(file.getParent());
		Files.write(file, PNG);
		this.vault.reconciler.reconcile(this.vault.path(path));
	}

	private ShareService shares() {
		return this.vault.shares;
	}

	private ShareResult share(String path, ShareMode mode, List<String> recipients, boolean link) throws IOException {
		return shares().create(new CreateShareRequest(path, mode, recipients, link, null), OWNER, "client-a1");
	}

	private JsonNode file() throws IOException {
		return TestVault.JSON.readTree(Files.readString(this.dir.resolve(ShareStore.FILE), StandardCharsets.UTF_8));
	}

	@Test
	void aShareIsStoredWithItsLinkHashedAndTheTokenShownOnce() throws IOException {
		start();
		note("Family/Groceries.md", "- [ ] milk\n");
		ShareResult made = share("Family/Groceries.md", ShareMode.EDIT, List.of("mom@example.com"), true);
		ShareInfo info = made.share();
		assertThat(info.id()).matches("[a-z0-9]{12}");
		assertThat(info.kind()).isEqualTo(ShareKind.NOTE);
		assertThat(info.state()).isEqualTo(ShareState.ACTIVE);
		assertThat(info.hasLink()).isTrue();
		assertThat(info.url()).isEqualTo("/s/" + info.id());
		assertThat(info.createdBy()).isEqualTo(OWNER.login());
		String token = made.link().substring("/s/".length());
		assertThat(token).matches("[A-Za-z0-9_-]{43}");

		String text = Files.readString(this.dir.resolve(ShareStore.FILE), StandardCharsets.UTF_8);
		assertThat(text).doesNotContain(token).contains(ShareTokens.hash(token)).endsWith("}\n");
		JsonNode entry = file().get("shares").get(0);
		assertThat(entry.get("path").asString()).isEqualTo("Family/Groceries.md");
		assertThat(entry.get("kind").asString()).isEqualTo("note");
		assertThat(entry.get("mode").asString()).isEqualTo("edit");
		assertThat(entry.get("recipients").get(0).asString()).isEqualTo("mom@example.com");
		assertThat(entry.get("expiresAt").isNull()).isTrue();
		assertThat(entry.get("createdByName").asString()).isEqualTo("Alice");
		// The list never carries the token; the owner's other tabs are told.
		assertThat(shares().list().shares()).singleElement().satisfies((s) -> assertThat(s.hasLink()).isTrue());
		assertThat(this.vault.hub.published).anyMatch((e) -> e instanceof SharesChangedEvent changed
				&& "client-a1".equals(changed.origin()));
		// It is found by id and by the token's hash, and only so.
		assertThat(shares().byId(info.id())).isNotNull();
		assertThat(shares().byLinkHash(ShareTokens.hash(token)).id()).isEqualTo(info.id());
		assertThat(shares().byLinkHash(ShareTokens.hash(ShareTokens.newToken()))).isNull();
		// Committed with the next batch, under the owner.
		assertThat(this.vault.flush().paths()).contains(ShareStore.FILE);
	}

	@Test
	void whatCanBeSharedAndHow() throws IOException {
		start();
		note("Family/Groceries.md", "x\n");
		note("Family/Board.canvas", "{}\n");
		note("Family/Drawing.excalidraw.md", "x\n");
		assertThat(share("Family", ShareMode.READ, List.of("dad@example.com"), false).share().kind())
			.isEqualTo(ShareKind.FOLDER);
		assertThat(code(() -> share("Family/Board.canvas", ShareMode.READ, List.of(), true)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
		assertThat(code(() -> share("Family/Drawing.excalidraw.md", ShareMode.READ, List.of(), true)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
		assertThat(code(() -> share("Family/Nothing.md", ShareMode.READ, List.of(), true)))
			.isEqualTo(ErrorCode.NOT_FOUND);
		assertThat(code(() -> share("", ShareMode.READ, List.of(), true))).isEqualTo(ErrorCode.BAD_REQUEST);
		assertThat(code(() -> share("Family/../Private", ShareMode.READ, List.of(), true)))
			.isEqualTo(ErrorCode.INVALID_PATH);
		assertThat(code(() -> share(".notesapp", ShareMode.READ, List.of(), true))).isEqualTo(ErrorCode.RESERVED_PATH);
		assertThat(code(() -> share("Family/Groceries.md", null, List.of(), true))).isEqualTo(ErrorCode.BAD_REQUEST);
		// Someone, or a link.
		assertThat(code(() -> share("Family/Groceries.md", ShareMode.READ, List.of(), false)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
		for (String bad : List.of("mom", "@example.com", "mom@", "mom @example.com", "mom@exa\nmple.com", "mom\"@x",
				"")) {
			assertThat(code(() -> share("Family/Groceries.md", ShareMode.READ, List.of(bad), false))).as(bad)
				.isEqualTo(ErrorCode.BAD_REQUEST);
		}
		List<String> many = new ArrayList<>();
		for (int i = 0; i <= ShareService.MAX_RECIPIENTS; i++) {
			many.add("p" + i + "@example.com");
		}
		assertThat(code(() -> share("Family/Groceries.md", ShareMode.READ, many, false)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
		// Recipients are kept as entered, once each ignoring case.
		assertThat(share("Family/Groceries.md", ShareMode.READ, List.of(" Mom@Example.com ", "mom@example.com"), false)
			.share()
			.recipients()).containsExactly("Mom@Example.com");
		Instant past = this.vault.clock.instant().minusSeconds(1);
		assertThat(code(() -> shares().create(
				new CreateShareRequest("Family/Groceries.md", ShareMode.READ, List.of(), true, past), OWNER, null)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
	}

	@Test
	void withoutAnOwnerListNothingCanBeShared() throws IOException {
		this.vault = TestVault.start(this.dir);
		note("Family/Groceries.md", "x\n");
		assertThat(shares().list().available()).isFalse();
		assertThat(shares().list().reason()).isEqualTo("no-owner-list");
		assertThat(code(() -> share("Family/Groceries.md", ShareMode.READ, List.of(), true)))
			.isEqualTo(ErrorCode.SHARING_UNAVAILABLE);
	}

	@Test
	void updatesReplaceTheSettingsAndANewLinkEndsTheOldOne() throws IOException {
		start();
		note("Family/Groceries.md", "x\n");
		ShareResult made = share("Family/Groceries.md", ShareMode.READ, List.of("mom@example.com"), true);
		String id = made.share().id();
		String oldHash = ShareTokens.hash(made.link().substring(3));
		ShareResult renewed = shares().update(id,
				new UpdateShareRequest(ShareMode.EDIT, List.of("dad@example.com"), ShareLinkAction.NEW, null), OWNER, null);
		assertThat(renewed.share().mode()).isEqualTo(ShareMode.EDIT);
		assertThat(renewed.share().recipients()).containsExactly("dad@example.com");
		assertThat(renewed.link()).startsWith("/s/").isNotEqualTo(made.link());
		assertThat(shares().byLinkHash(oldHash)).isNull();
		assertThat(shares().byLinkHash(ShareTokens.hash(renewed.link().substring(3))).id()).isEqualTo(id);
		ShareResult kept = shares().update(id,
				new UpdateShareRequest(ShareMode.EDIT, List.of("dad@example.com"), ShareLinkAction.KEEP, null), OWNER,
				null);
		assertThat(kept.link()).isNull();
		assertThat(kept.share().hasLink()).isTrue();
		assertThat(shares().update(id,
				new UpdateShareRequest(ShareMode.EDIT, List.of("dad@example.com"), ShareLinkAction.NONE, null), OWNER,
				null)
			.share()
			.hasLink()).isFalse();
		// Nobody and no link is a revoke, not an update.
		assertThat(code(() -> shares().update(id,
				new UpdateShareRequest(ShareMode.EDIT, List.of(), ShareLinkAction.NONE, null), OWNER, null)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
		assertThat(code(() -> shares().update("nosuchshare1",
				new UpdateShareRequest(ShareMode.EDIT, List.of("a@b"), ShareLinkAction.KEEP, null), OWNER, null)))
			.isEqualTo(ErrorCode.NOT_FOUND);
	}

	@Test
	void anExpiredShareKeepsItsDateUntilTheOwnerExtendsIt() throws IOException {
		start();
		note("Family/Groceries.md", "x\n");
		Instant soon = this.vault.clock.instant().plus(Duration.ofDays(1));
		ShareResult made = shares().create(
				new CreateShareRequest("Family/Groceries.md", ShareMode.READ, List.of("mom@example.com"), false, soon),
				OWNER, null);
		this.vault.clock.advance(Duration.ofDays(2));
		ShareInfo listed = shares().list().shares().get(0);
		assertThat(listed.state()).isEqualTo(ShareState.EXPIRED);
		String id = made.share().id();
		assertThat(shares().byId(id).expired(this.vault.clock.instant())).isTrue();
		// Changing the people of an expired share keeps its (past) date; a new past date is refused.
		shares().update(id, new UpdateShareRequest(ShareMode.READ, List.of("dad@example.com"), ShareLinkAction.KEEP,
				soon), OWNER, null);
		assertThat(code(() -> shares().update(id, new UpdateShareRequest(ShareMode.READ, List.of("dad@example.com"),
				ShareLinkAction.KEEP, soon.minusSeconds(60)), OWNER, null)))
			.isEqualTo(ErrorCode.BAD_REQUEST);
		Instant later = this.vault.clock.instant().plus(Duration.ofDays(7));
		shares().update(id, new UpdateShareRequest(ShareMode.READ, List.of("dad@example.com"), ShareLinkAction.KEEP,
				later), OWNER, null);
		assertThat(shares().list().shares().get(0).state()).isEqualTo(ShareState.ACTIVE);
	}

	@Test
	void revokingRemovesTheShare() throws IOException {
		start();
		note("Family/Groceries.md", "x\n");
		String id = share("Family/Groceries.md", ShareMode.READ, List.of("mom@example.com"), true).share().id();
		shares().revoke(id, OWNER, null);
		assertThat(shares().byId(id)).isNull();
		assertThat(shares().list().shares()).isEmpty();
		assertThat(code(() -> shares().revoke(id, OWNER, null))).isEqualTo(ErrorCode.NOT_FOUND);
	}

	@Test
	void sharesFollowMovesAndRenames() throws IOException {
		start();
		note("Family/Groceries.md", "x\n");
		note("Family/Recipes/Pie.md", "x\n");
		note("Other/Note.md", "x\n");
		String note = share("Family/Groceries.md", ShareMode.READ, List.of("mom@example.com"), false).share().id();
		String folder = share("Family/Recipes", ShareMode.READ, List.of("mom@example.com"), false).share().id();
		String other = share("Other/Note.md", ShareMode.READ, List.of("mom@example.com"), false).share().id();
		this.vault.moves.move("Family/Groceries.md", "Family/Shopping.md", false, false, OWNER, null);
		assertThat(shares().byId(note).path()).isEqualTo("Family/Shopping.md");
		this.vault.moves.move("Family", "Home", false, false, OWNER, null);
		assertThat(shares().byId(note).path()).isEqualTo("Home/Shopping.md");
		assertThat(shares().byId(folder).path()).isEqualTo("Home/Recipes");
		assertThat(shares().byId(other).path()).isEqualTo("Other/Note.md");
		// A deleted target leaves the share, missing, until it comes back.
		this.vault.trash.deleteFile("Other/Note.md", OWNER, null);
		assertThat(shares().list().shares().stream().filter((s) -> s.id().equals(other)).findFirst().orElseThrow()
			.state()).isEqualTo(ShareState.MISSING);
	}

	@Test
	void handEditsAreTakenAsFarAsTheyAreWellFormed() throws IOException {
		start();
		String hash = ShareTokens.hash(ShareTokens.newToken());
		Files.createDirectories(this.dir.resolve(".notesapp"));
		Files.writeString(this.dir.resolve(ShareStore.FILE), """
				{ "shares": [
				  { "id": "aaaaaaaaaaaa", "path": "Family/Groceries.md", "kind": "note", "mode": "edit",
				    "recipients": ["mom@example.com", "not a login", 7, "MOM@example.com"],
				    "link": { "hash": "%s", "createdAt": "2026-10-16T12:00:00.000Z" } },
				  { "id": "bbbbbbbbbbbb", "path": "Family", "kind": "folder", "mode": "read",
				    "link": { "hash": "not-hex" }, "expiresAt": "soon" },
				  { "id": "BAD", "path": "Family", "kind": "folder", "mode": "read" },
				  { "id": "cccccccccccc", "path": "../Private", "kind": "folder", "mode": "read" },
				  { "id": "dddddddddddd", "path": ".git", "kind": "folder", "mode": "read" },
				  { "id": "eeeeeeeeeeee", "path": "Family", "kind": "vault", "mode": "read" },
				  { "id": "ffffffffffff", "path": "Family", "kind": "folder", "mode": "admin" },
				  { "id": "aaaaaaaaaaaa", "path": "Duplicate.md", "kind": "note", "mode": "read" },
				  "not an object"
				] }
				""".formatted(hash), StandardCharsets.UTF_8);
		List<Share> read = this.vault.shareStore.read();
		assertThat(read).extracting(Share::id).containsExactly("aaaaaaaaaaaa", "bbbbbbbbbbbb");
		assertThat(read.get(0).recipients()).containsExactly("mom@example.com");
		assertThat(read.get(0).link().hash()).isEqualTo(hash);
		assertThat(read.get(1).link()).isNull();
		assertThat(read.get(1).expiresAt()).isNull();

		Files.writeString(this.dir.resolve(ShareStore.FILE), "{ not json");
		assertThat(code(() -> shares().list())).isEqualTo(ErrorCode.MALFORMED_FILE);
	}

	@Test
	void theViewOfAShareIsItsFilesAndTheMediaItsNotesEmbed() throws IOException {
		start();
		image("Attachments/photo.png");
		image("Attachments/unused.png");
		image("Family/Recipes/pie.png");
		note("Private/Diary.md", "secret\n");
		note("Family/Groceries.md", "![[photo.png]] ![[Diary]] [[unused.png]] ![[gone.png]] ![](../Attachments/photo.png)\n");
		note("Family/Recipes/Pie.md", "![[pie.png]] ![[photo.png]]\n");
		Share note = shares().byId(share("Family/Groceries.md", ShareMode.READ, List.of("a@b"), false).share().id());
		assertThat(shares().embeddedMedia(note)).containsExactly("Attachments/photo.png");
		GuestShareResponse view = shares().view(note, TestVault.BOB);
		assertThat(view.files()).extracting((f) -> f.path()).containsExactly("Family/Groceries.md");
		assertThat(view.embedded()).extracting((f) -> f.path()).containsExactly("Attachments/photo.png");
		assertThat(view.folders()).isEmpty();
		assertThat(view.title()).isEqualTo("Groceries");
		assertThat(view.sharedBy()).isEqualTo("Alice");
		assertThat(view.login()).isEqualTo(TestVault.BOB.login());

		Share folder = shares().byId(share("Family/Recipes", ShareMode.READ, List.of("a@b"), false).share().id());
		assertThat(shares().embeddedMedia(folder)).containsExactly("Attachments/photo.png");
		GuestShareResponse folderView = shares().view(folder, TestVault.BOB);
		assertThat(folderView.files()).extracting((f) -> f.path())
			.containsExactlyInAnyOrder("Family/Recipes/Pie.md", "Family/Recipes/pie.png");
		assertThat(folderView.folders()).extracting((f) -> f.path()).containsExactly("Family/Recipes");
		assertThat(shares().rawAllowed(folder, "Family/Recipes/pie.png")).isTrue();
		assertThat(shares().rawAllowed(folder, "Attachments/unused.png")).isFalse();
		// An edit changes the media at once (the cache follows the index).
		this.vault.files.saveText("Family/Recipes/Pie.md", "no images\n",
				this.vault.files.readText("Family/Recipes/Pie.md").version(), false, OWNER, null);
		assertThat(shares().embeddedMedia(folder)).isEmpty();
	}

	@Test
	void aGuestCannotAddAnEmbedThatReachesOutside() throws IOException {
		start();
		image("Attachments/photo.png");
		image("Attachments/secret.png");
		image("Family/Recipes/pie.png");
		note("Private/Diary.md", "secret\n");
		note("Family/Recipes/Pie.md", "# Pie\n![[photo.png]]\n![[missing.png]]\n");
		Share share = shares().byId(share("Family/Recipes", ShareMode.EDIT, List.of("a@b"), false).share().id());
		String pie = "Family/Recipes/Pie.md";
		// What the note embeds stays fine, edits around it too; embeds inside the folder are always fine.
		shares().checkGuestEmbeds(share, pie, "# Pie!\n![[photo.png]]\n![[missing.png]]\n![[pie.png]]\n");
		for (String added : List.of("![[secret.png]]", "![[Diary]]", "![[nothing.png]]", "![x](Attachments/secret.png)")) {
			assertThat(code(() -> shares().checkGuestEmbeds(share, pie, "# Pie\n" + added + "\n"))).as(added)
				.isEqualTo(ErrorCode.OUTSIDE_SHARE);
		}
		// A new note has no embeds yet: the folder's own files only, or media the share embeds.
		shares().checkGuestEmbeds(share, "Family/Recipes/New.md", "![[pie.png]] ![[photo.png]]\n");
		assertThat(code(() -> shares().checkGuestEmbeds(share, "Family/Recipes/New.md", "![[missing.png]]\n")))
			.isEqualTo(ErrorCode.OUTSIDE_SHARE);
		// The note stops embedding the photo: it can come back for a day, not after.
		this.vault.files.saveText(pie, "# Pie\n", this.vault.files.readText(pie).version(), false, OWNER, null);
		this.vault.clock.advance(Duration.ofHours(23));
		shares().checkGuestEmbeds(share, pie, "# Pie\n![[photo.png]]\n");
		this.vault.clock.advance(Duration.ofHours(2));
		assertThat(code(() -> shares().checkGuestEmbeds(share, pie, "# Pie\n![[photo.png]]\n")))
			.isEqualTo(ErrorCode.OUTSIDE_SHARE);
	}

	@Test
	void aLeadingBomDoesNotHideAFrontmatterEmbedFromTheCheck() throws IOException {
		start();
		image("Attachments/secret.png");
		note("Family/Recipes/Pie.md", "# Pie\n");
		Share share = shares().byId(share("Family/Recipes", ShareMode.EDIT, List.of("a@b"), false).share().id());
		// The index strips one leading BOM, then reads the frontmatter and every embed in its values; the check sees
		// the same text, whether the guest saves the note or creates one.
		for (String value : List.of("\"%%![[secret.png]]%%\"", "\"`![[secret.png]]`\"", "\"!\\x5B[secret.png]]\"")) {
			String text = "\uFEFF---\ncover: " + value + "\n---\n# Pie\n";
			for (String path : List.of("Family/Recipes/Pie.md", "Family/Recipes/New.md")) {
				assertThat(code(() -> shares().checkGuestEmbeds(share, path, text))).as(path + " " + value)
					.isEqualTo(ErrorCode.OUTSIDE_SHARE);
			}
		}
		// A note that already starts with a BOM keeps it and gets the guest's text after it, so the index then reads
		// the guest's own BOM as text: the frontmatter is body, and a YAML comment there is a heading with an embed.
		Path bom = this.dir.resolve("Family/Recipes/Bom.md");
		Files.write(bom, TextCodec.encode("# Bom\n", true));
		this.vault.reconciler.reconcile(this.vault.path("Family/Recipes/Bom.md"));
		assertThat(code(() -> shares().checkGuestEmbeds(share, "Family/Recipes/Bom.md",
				"\uFEFF---\n# ![[secret.png]]\ntitle: x\n---\n# Bom\n")))
			.isEqualTo(ErrorCode.OUTSIDE_SHARE);
		// A lone surrogate is written as "?", which YAML accepts: the check reads the text as written.
		assertThat(code(() -> shares().checkGuestEmbeds(share, "Family/Recipes/Pie.md",
				"---\ncover: \"`![[secret.png]]`\"\nnote: \"\uD800\"\n---\n# Pie\n")))
			.isEqualTo(ErrorCode.OUTSIDE_SHARE);
		assertThat(shares().embeddedMedia(share)).isEmpty();
	}

	@Test
	void theLandingListsTheUnexpiredSharesNamingALogin() throws IOException {
		start();
		note("A.md", "x\n");
		note("B.md", "x\n");
		share("A.md", ShareMode.EDIT, List.of("Mom@Example.com"), false);
		share("B.md", ShareMode.READ, List.of("dad@example.com"), true);
		assertThat(shares().sharesNaming("mom@example.com", null)).singleElement().satisfies((s) -> {
			assertThat(s.title()).isEqualTo("A");
			assertThat(s.mode()).isEqualTo(ShareMode.EDIT);
			assertThat(s.vault()).isNull();
			assertThat(s.url()).startsWith("/s/");
		});
		assertThat(shares().sharesNaming("stranger@example.com", null)).isEmpty();
	}

	private static ErrorCode code(ThrowingRunnable action) {
		try {
			action.run();
		}
		catch (NotesException ex) {
			return ex.code();
		}
		catch (Exception ex) {
			throw new AssertionError(ex);
		}
		throw new AssertionError("no NotesException");
	}

	@FunctionalInterface
	private interface ThrowingRunnable {

		void run() throws Exception;

	}

	@Test
	void shareStoreRejectsAWrittenFileThatIsNotJsonButKeepsCaching() throws IOException {
		start();
		note("A.md", "x\n");
		share("A.md", ShareMode.READ, List.of("a@b"), false);
		List<Share> first = this.vault.shareStore.read();
		assertThat(this.vault.shareStore.read()).isSameAs(first);
		assertThatThrownBy(() -> this.vault.shareStore.parse("[1, 2")).isInstanceOf(NotesException.class);
	}

}

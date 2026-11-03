package com.rjgehan.notes.watch;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which watch events reach the reconciler (DESIGN §4.5, §5.9): hidden entries never, ignored names (editor temp files)
 * only for files, as the vault walk does, so a folder named {@code Drafts~} or {@code old.tmp} is watched and indexed.
 */
class VaultWatcherNamesTest {

	@Test
	void hiddenEntriesAreIgnoredWhateverTheirType() {
		assertThat(VaultWatcher.isIgnored(".git/index", false)).isTrue();
		assertThat(VaultWatcher.isIgnored(".git", true)).isTrue();
		assertThat(VaultWatcher.isIgnored("Notes/.obsidian/workspace.json", false)).isTrue();
		assertThat(VaultWatcher.isIgnored("Notes/.obsidian", true)).isTrue();
	}

	@Test
	void ignoredNamesAreIgnoredForFilesOnly() {
		assertThat(VaultWatcher.isIgnored("Notes/draft.md.swp", false)).isTrue();
		assertThat(VaultWatcher.isIgnored("Drafts~", false)).isTrue();
		assertThat(VaultWatcher.isIgnored("Drafts~", true)).isFalse();
		assertThat(VaultWatcher.isIgnored("Archive/old.tmp", true)).isFalse();
		assertThat(VaultWatcher.isIgnored("clip.part", true)).isFalse();
		assertThat(VaultWatcher.isIgnored("4913", true)).isFalse();
		assertThat(VaultWatcher.isIgnored("Notes/Plan.md", false)).isFalse();
	}

}

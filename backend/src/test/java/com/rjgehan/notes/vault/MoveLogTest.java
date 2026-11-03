package com.rjgehan.notes.vault;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** Where a path went after moves in this boot (DESIGN §5.6). */
class MoveLogTest {

	private final MoveLog log = new MoveLog();

	@Test
	void aMoveAndAChainAreFollowed() {
		this.log.record("Plan.md", "Projects/Plan.md");
		assertThat(this.log.movedTo("Plan.md")).isEqualTo("Projects/Plan.md");
		this.log.record("Projects/Plan.md", "Archive/Plan.md");
		assertThat(this.log.movedTo("Plan.md")).isEqualTo("Archive/Plan.md");
		assertThat(this.log.movedTo("Other.md")).isNull();
	}

	@Test
	void aCaseOnlyRenameIsFollowed() {
		this.log.record("meeting notes.md", "Meeting notes.md");
		assertThat(this.log.movedTo("meeting notes.md")).isEqualTo("Meeting notes.md");
	}

	@Test
	void aCaseOnlyFolderRenameIsFollowed() {
		this.log.record("Projects/Plan.md", "projects/Plan.md");
		assertThat(this.log.movedTo("Projects/Plan.md")).isEqualTo("projects/Plan.md");
	}

	@Test
	void aMoveAwayAndBackInAnotherCaseIsFollowed() {
		this.log.record("Note.md", "Other.md");
		this.log.record("Other.md", "note.md");
		assertThat(this.log.movedTo("Note.md")).isEqualTo("note.md");
	}

	@Test
	void aMoveBackToTheSameSpellingIsNoMove() {
		this.log.record("Note.md", "Other.md");
		this.log.record("Other.md", "Note.md");
		assertThat(this.log.movedTo("Note.md")).isNull();
	}

}

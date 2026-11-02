package com.rjgehan.notes.share;

import com.rjgehan.notes.api.dto.ShareKind;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** What a share covers and how it follows a move (DESIGN §5.40): plain, case-sensitive comparisons of NFC paths. */
class ShareScopeTest {

	@Test
	void aNoteShareIsItsNoteOnly() {
		assertThat(ShareScope.contains(ShareKind.NOTE, "Family/Groceries.md", "Family/Groceries.md")).isTrue();
		for (String other : new String[] { "Family/groceries.md", "Family/Groceries.MD", "Family/Groceries.md/x",
				"Family", "Family/Other.md", "Groceries.md", "", "Family/Groceries.md " }) {
			assertThat(ShareScope.contains(ShareKind.NOTE, "Family/Groceries.md", other)).as(other).isFalse();
		}
	}

	@Test
	void aFolderShareIsEverythingStrictlyUnderItsFolder() {
		assertThat(ShareScope.contains(ShareKind.FOLDER, "Family", "Family/Groceries.md")).isTrue();
		assertThat(ShareScope.contains(ShareKind.FOLDER, "Family", "Family/Recipes/Pie.md")).isTrue();
		for (String other : new String[] { "Family", "Family2/Secret.md", "Familyx", "family/Groceries.md", "Fam",
				"Other/Family/x.md", "" }) {
			assertThat(ShareScope.contains(ShareKind.FOLDER, "Family", other)).as(other).isFalse();
		}
		// A folder share of the vault's root is never made; if a hand edit made one, it covers nothing.
		assertThat(ShareScope.contains(ShareKind.FOLDER, "", "Anything.md")).isFalse();
	}

	@Test
	void sharesFollowTheMovesThatConcernThem() {
		assertThat(ShareScope.moved("Family/Groceries.md", "Family/Groceries.md", "Lists/Shopping.md"))
			.isEqualTo("Lists/Shopping.md");
		assertThat(ShareScope.moved("Family/Recipes", "Family", "Home")).isEqualTo("Home/Recipes");
		assertThat(ShareScope.moved("Family/Recipes", "Family/Recipes", "Cooking")).isEqualTo("Cooking");
		assertThat(ShareScope.moved("Family2/x.md", "Family", "Home")).isNull();
		assertThat(ShareScope.moved("Family", "Family/Recipes", "Cooking")).isNull();
		assertThat(ShareScope.isRootOrAbove("Family/Recipes", "Family")).isTrue();
		assertThat(ShareScope.isRootOrAbove("Family/Recipes", "Family/Recipes")).isTrue();
		assertThat(ShareScope.isRootOrAbove("Family/Recipes", "Family/Recipes/Pie.md")).isFalse();
		assertThat(ShareScope.isRootOrAbove("Family2/Recipes", "Family")).isFalse();
	}

	@Test
	void keysTellIdsFromLinksByTheirShape() {
		String id = ShareTokens.newId();
		String token = ShareTokens.newToken();
		assertThat(ShareTokens.isId(id)).isTrue();
		assertThat(ShareTokens.isToken(id)).isFalse();
		assertThat(ShareTokens.isToken(token)).isTrue();
		assertThat(ShareTokens.isId(token)).isFalse();
		assertThat(ShareTokens.newToken()).isNotEqualTo(token);
		assertThat(ShareTokens.hash(token)).matches("[0-9a-f]{64}").isEqualTo(ShareTokens.hash(token));
		assertThat(ShareTokens.sameHash(ShareTokens.hash(token), ShareTokens.hash(token))).isTrue();
		assertThat(ShareTokens.sameHash(ShareTokens.hash(token), ShareTokens.hash(id))).isFalse();
		for (String bad : new String[] { "", "ABCDEFGHIJKL", "abc", id + "x", token + "x", "../../etc/passwd",
				"abcdefghijk%", token.substring(1) + "=" }) {
			assertThat(ShareTokens.isId(bad) || ShareTokens.isToken(bad)).as(bad).isFalse();
		}
	}

}

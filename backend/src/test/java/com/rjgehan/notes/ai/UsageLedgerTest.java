package com.rjgehan.notes.ai;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneOffset;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.rjgehan.notes.support.TestVault;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;

/** The month's AI spend survives a backup and restore (DESIGN §5.25); {@code GitExcludeTest} keeps it out of git. */
class UsageLedgerTest {

	@TempDir
	Path dir;

	@Test
	void theLedgerIsInTheBackups() throws Exception {
		String script = Files.readString(Path.of("../deploy/backup/restic-job.sh"));
		Matcher matcher = Pattern.compile("--exclude \"\\$SOURCE/notes-data/vault/([^\"]+)\"").matcher(script);
		List<String> excluded = matcher.results().map((m) -> m.group(1)).toList();
		assertThat(excluded).contains(".notesapp/cache", ".notesapp/tmp");
		for (String folder : excluded) {
			assertThat(UsageLedger.FILE).as(folder).doesNotStartWith(folder + "/").isNotEqualTo(folder);
		}
	}

	@Test
	void aLedgerOfAnEarlierBuildIsReadOnceAndMoved() throws Exception {
		Path legacy = this.dir.resolve(".notesapp/cache/ai-usage.json");
		Files.createDirectories(legacy.getParent());
		Files.writeString(legacy, """
				{"schemaVersion": 1, "months": {"2026-10": {"requests": 7, "costUsd": 4.9, "inputTokens": 1,
				 "outputTokens": 2, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0}}}
				""");
		try (TestVault vault = TestVault.start(this.dir)) {
			UsageLedger ledger = new UsageLedger(vault.fs, vault.clock, TestVault.JSON, ZoneOffset.UTC);
			assertThat(ledger.thisMonth().requests()).isEqualTo(7);
			assertThat(ledger.thisMonth().costUsd()).isEqualTo(4.9);
			ledger.record(0.05, AiModels.Usage.ZERO);
			assertThat(Files.readString(this.dir.resolve(UsageLedger.FILE))).contains("\"requests\":8");
			assertThat(legacy).doesNotExist();
			// A later start reads the new file.
			UsageLedger again = new UsageLedger(vault.fs, vault.clock, TestVault.JSON, ZoneOffset.UTC);
			assertThat(again.thisMonth().requests()).isEqualTo(8);
		}
	}

}

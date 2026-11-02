package com.rjgehan.notes.index;

import com.rjgehan.notes.vault.TextCodec;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class FileIndexerTest {

	@Test
	void aScannerDefectIndexesTheNoteAsPlainText() {
		TextCodec.Decoded decoded = TextCodec.decode(TextCodec.encode("# Title\n[[Link]] #tag\n", true));
		NoteParse parse = FileIndexer.parse("Broken.md", decoded, (text, hadBom, lossy) -> {
			throw new StringIndexOutOfBoundsException("a scanner defect");
		});
		assertThat(parse.links()).isEmpty();
		assertThat(parse.tags()).isEmpty();
		assertThat(parse.headings()).isEmpty();
		assertThat(parse.frontmatter()).isNull();
		assertThat(parse.lineStarts()).containsExactly(0, 8, 22);
		assertThat(parse.hadBom()).isTrue();

		NoteParse deep = FileIndexer.parse("Deep.md", decoded, (text, hadBom, lossy) -> {
			throw new StackOverflowError();
		});
		assertThat(deep.lineStarts()).containsExactly(0, 8, 22);

		NoteParse scanned = FileIndexer.parse("Fine.md", decoded, MarkdownScanner::scan);
		assertThat(scanned.links()).extracting(LinkOcc::target).containsExactly("Link");
	}

}

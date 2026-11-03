package com.rjgehan.notes.drawings;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;

/**
 * The parts of an Obsidian Excalidraw {@code .excalidraw.md} file the index reads (DESIGN §6.8.1), located line by
 * line like the editor's {@code format.ts}: the scene in the last {@code # Drawing} or {@code ## Drawing} section's
 * {@code json} or {@code compressed-json} (lz-string base64) block, and which elements the Markdown before it already
 * describes. The plugin writes each text element as a {@code text ^id} entry under {@code ## Text Elements} and each
 * element link as an {@code id: link} line under {@code ## Element Links}; when it loads a drawing, those entries take
 * priority over the JSON, and JSON elements without one are added to them. {@code textBody} is the Text Elements
 * section's body ({@code ""} without one), read into entries by {@link #texts(Set)} with the scene's element ids.
 */
public record MarkdownDrawing(String json, String textBody, Set<String> linkIds) {

	/**
	 * Larger blocks are not decompressed: lz-string can expand crafted input quadratically, and a real drawing of
	 * this size would be far past the text size limit as plain JSON.
	 */
	static final int MAX_JSON_LENGTH = 16 * 1024 * 1024;

	private static final Pattern DRAWING_HEADING = Pattern.compile("#{1,2} Drawing[ \\t]*");

	private static final Pattern FENCE_OPEN = Pattern.compile("```(json|compressed-json)[ \\t]*");

	private static final Pattern FENCE_CLOSE = Pattern.compile("```[ \\t]*");

	private static final Pattern TEXT_HEADING = Pattern.compile("#{1,2} Text Elements[ \\t]*");

	private static final Pattern TEXT_SECTION_END = Pattern
		.compile("(?:#{1,2} (?:Element Links|Embedded [Ff]iles|Drawing)|%%)[ \\t]*");

	/** {@code ^id} closing a text entry: the plugin's block ids have 8 characters. */
	private static final Pattern TEXT_ID = Pattern.compile("[ \\t\\n]\\^([A-Za-z0-9_-]{8})[ \\t]*(?:\\n+|$)");

	/** An {@code id: link} line of the Element Links section. */
	private static final Pattern LINK_LINE = Pattern.compile("(?m)^([A-Za-z0-9_-]{8}):");

	/**
	 * The drawing in {@code text} (LF or CRLF), or null when the file has no drawing block, or its block does not
	 * decompress.
	 */
	public static @Nullable MarkdownDrawing parse(String text) {
		String[] lines = text.replace("\r\n", "\n").split("\n", -1);
		int heading = -1;
		int close = -1;
		boolean compressed = false;
		// The last Drawing heading followed by a json block: the plugin writes it at the end. The walk back keeps the
		// nearest closing fence, so that a crafted file of unclosed blocks is scanned in linear time.
		int nearestClose = -1;
		for (int i = lines.length - 2; i >= 0 && heading < 0; i--) {
			if (i + 2 < lines.length && FENCE_CLOSE.matcher(lines[i + 2]).matches()) {
				nearestClose = i + 2;
			}
			if (nearestClose < 0 || !DRAWING_HEADING.matcher(lines[i]).matches()) {
				continue;
			}
			Matcher fence = FENCE_OPEN.matcher(lines[i + 1]);
			if (fence.matches()) {
				heading = i;
				close = nearestClose;
				compressed = "compressed-json".equals(fence.group(1));
			}
		}
		if (heading < 0) {
			return null;
		}
		String block = String.join("\n", Arrays.copyOfRange(lines, heading + 2, close));
		String json = compressed ? LzString.decompressFromBase64(block, MAX_JSON_LENGTH) : block;
		if (json == null || (compressed && json.isEmpty())) {
			return null;
		}
		String textBody = "";
		Set<String> linkIds = new HashSet<>();
		StringBuilder before = new StringBuilder();
		boolean textSection = false;
		int textStart = -1;
		for (int i = 0; i < heading; i++) {
			if (textStart >= 0 && TEXT_SECTION_END.matcher(lines[i]).matches()) {
				textBody = before.substring(textStart);
				textStart = -1;
			}
			before.append(lines[i]).append('\n');
			if (!textSection && TEXT_HEADING.matcher(lines[i]).matches()) {
				textSection = true;
				textStart = before.length();
			}
		}
		if (textStart >= 0) {
			textBody = before.substring(textStart);
		}
		Matcher link = LINK_LINE.matcher(before);
		while (link.find()) {
			linkIds.add(link.group(1));
		}
		return new MarkdownDrawing(json, textBody, Set.copyOf(linkIds));
	}

	/**
	 * The {@code text ^id} entries of the Text Elements section, by id. A text's own line that ends like an entry
	 * ({@code Call the plumber ^tomorrow}) does not end it: only one of {@code elementIds} does, or an id followed by a
	 * blank line or the end of the section, as entries are written.
	 */
	public Map<String, String> texts(Set<String> elementIds) {
		Map<String, String> texts = new HashMap<>();
		String body = this.textBody;
		Matcher entry = TEXT_ID.matcher(body);
		int from = 0;
		int search = 0;
		while (search <= body.length() && entry.find(search)) {
			if (!elementIds.contains(entry.group(1)) && entry.end() < body.length() && !entry.group().contains("\n\n")) {
				// Part of the text: look on from the next character (the next match may start inside this one).
				search = entry.start() + 1;
				continue;
			}
			texts.putIfAbsent(entry.group(1), body.substring(from, entry.start()));
			from = entry.end();
			search = from;
		}
		return Map.copyOf(texts);
	}

}

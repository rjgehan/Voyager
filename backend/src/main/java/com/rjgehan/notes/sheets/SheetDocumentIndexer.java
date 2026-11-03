package com.rjgehan.notes.sheets;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.rjgehan.notes.index.DocumentIndexer;
import com.rjgehan.notes.vault.PathNames;
import org.jspecify.annotations.Nullable;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.stereotype.Component;

/**
 * Indexes {@code .sheet} spreadsheets for search, backlinks and tags (ROADMAP item 6b, DESIGN §6.21.7). What a cell
 * shows is a block of its own: its text or number, or the cached {@code c} value of its formula (the frontend writes
 * every formula's result into the file, so no engine runs here), and the values an array formula spilled into other
 * cells. A {@code [[Note]]} written in a cell, or computed by a formula, is therefore a backlink, and a {@code #tag}
 * a tag, as in a note; one block per cell keeps markup in one cell from reaching into the next. Sheet names and chart
 * titles are searchable too. Formulas themselves, error results, number formats and the JSON around the values are
 * not indexed, except formulas that read a note by name ({@code =NOTEPROP("Plan", "status")}, ROADMAP item 42,
 * DESIGN §6.47): each is a block with the note's name as a wikilink, so the spreadsheet is a backlink of the note it
 * reads, with the formula as the context. Files that are not readable sheets are not content-indexed.
 */
@Component
public class SheetDocumentIndexer implements DocumentIndexer {

	private static final String EXTENSION = ".sheet";

	private static final String TYPE = "notesapp-sheet";

	/**
	 * The newest format version read (DESIGN §6.21.1). Version 2 adds filters, conditional formatting
	 * and data validation, which change nothing indexed.
	 */
	private static final int VERSION = 2;

	private static final Pattern CELL = Pattern.compile("([A-Z]{1,3})([1-9][0-9]{0,6})");

	private static final BigDecimal LARGE = new BigDecimal("1e15");

	private static final BigDecimal SMALL = new BigDecimal("1e-6");

	/** The functions whose first argument names a note (ROADMAP item 42). */
	private static final Set<String> NOTE_READERS = Set.of("NOTEPROP", "NOTETABLE");

	private final JsonMapper mapper;

	public SheetDocumentIndexer(JsonMapper mapper) {
		this.mapper = mapper;
	}

	@Override
	public boolean supports(String path) {
		return PathNames.lower(path).endsWith(EXTENSION);
	}

	@Override
	public @Nullable Document index(String path, String text) {
		String body = text.startsWith("﻿") ? text.substring(1) : text;
		if (body.isBlank()) {
			// A new, empty file opens as an empty workbook.
			return new Document(List.of());
		}
		JsonNode root;
		try {
			root = this.mapper.readTree(body);
		}
		catch (JacksonException ex) {
			return null;
		}
		if (root == null || !root.isObject() || !isText(root.get("type"), TYPE)) {
			return null;
		}
		JsonNode version = root.get("version");
		if (version != null && !(version.isIntegralNumber() && version.canConvertToInt() && version.intValue() >= 1
				&& version.intValue() <= VERSION)) {
			// A newer format is shown read-only by the frontend until Voyager is updated; its layout is unknown.
			return null;
		}
		List<String> blocks = new ArrayList<>();
		JsonNode sheets = root.get("sheets");
		if (sheets != null && sheets.isArray()) {
			for (JsonNode sheet : sheets.values()) {
				if (sheet.isObject()) {
					addSheet(blocks, sheet);
				}
			}
		}
		return new Document(List.copyOf(blocks));
	}

	private static void addSheet(List<String> blocks, JsonNode sheet) {
		String name = scalarText(sheet.get("name"));
		if (name != null && !name.isBlank()) {
			blocks.add(oneLine(name));
		}
		JsonNode cells = sheet.get("cells");
		if (cells != null && cells.isObject()) {
			// Row-major, as the grid shows them and the file stores them.
			Map<Long, String> shown = new TreeMap<>();
			Map<Long, String> reads = new TreeMap<>();
			for (Map.Entry<String, JsonNode> entry : cells.properties()) {
				long position = position(entry.getKey());
				String value = shownText(entry.getValue());
				if (position >= 0 && value != null && !value.isBlank()) {
					shown.put(position, value);
				}
				JsonNode formula = entry.getValue().isObject() ? entry.getValue().get("f") : null;
				String read = (position >= 0 && formula != null && formula.isString()) ? noteReads(formula.stringValue())
						: null;
				if (read != null) {
					reads.put(position, read);
				}
			}
			blocks.addAll(shown.values());
			blocks.addAll(reads.values());
		}
		JsonNode charts = sheet.get("charts");
		if (charts != null && charts.isObject()) {
			charts.properties()
				.stream()
				.sorted(Map.Entry.comparingByKey(Comparator.naturalOrder()))
				.map((entry) -> entry.getValue().isObject() ? scalarText(entry.getValue().get("title")) : null)
				.filter((title) -> title != null && !title.isBlank())
				.forEach((title) -> blocks.add(oneLine(title)));
		}
	}

	/**
	 * What a cell shows, as the grid does: a formula's cached result, otherwise the literal value, otherwise the
	 * cached value alone (a value an array formula spilled into the cell). A bare value is a literal.
	 */
	static @Nullable String shownText(JsonNode cell) {
		if (!cell.isObject()) {
			return scalarText(cell);
		}
		JsonNode formula = cell.get("f");
		if (formula != null && formula.isString() && !formula.stringValue().isBlank()) {
			return scalarText(cell.get("c"));
		}
		String literal = scalarText(cell.get("v"));
		return (literal != null) ? literal : scalarText(cell.get("c"));
	}

	/** Text, a number as the grid's Automatic format writes it, or TRUE/FALSE; null for anything else. */
	static @Nullable String scalarText(@Nullable JsonNode node) {
		if (node == null) {
			return null;
		}
		if (node.isString()) {
			return node.stringValue();
		}
		if (node.isBoolean()) {
			return node.booleanValue() ? "TRUE" : "FALSE";
		}
		if (node.isNumber()) {
			return number(node);
		}
		// null, an error result ({"e": "#DIV/0!"}) or a value this version cannot show.
		return null;
	}

	private static @Nullable String number(JsonNode node) {
		if (node.isIntegralNumber()) {
			return node.bigIntegerValue().toString();
		}
		double value = node.doubleValue();
		if (!Double.isFinite(value)) {
			return null;
		}
		BigDecimal decimal = BigDecimal.valueOf(value).stripTrailingZeros();
		if (decimal.signum() == 0) {
			return "0";
		}
		BigDecimal magnitude = decimal.abs();
		return (magnitude.compareTo(LARGE) >= 0 || magnitude.compareTo(SMALL) < 0) ? decimal.toString()
				: decimal.toPlainString();
	}

	/**
	 * A formula that reads notes by name ({@code =NOTEPROP("Projects/Plan", "status")}, {@code =NOTETABLE("Costs")},
	 * ROADMAP item 42) with each note's name as a wikilink ({@code =NOTEPROP([[Projects/Plan]], "status")}), or null
	 * when it names no note: only a first argument written as text names one, as the frontend reads it.
	 */
	static @Nullable String noteReads(String formula) {
		if (!formula.stripLeading().startsWith("=")) {
			return null;
		}
		StringBuilder out = new StringBuilder();
		int copied = 0;
		boolean found = false;
		int n = formula.length();
		int i = 0;
		while (i < n) {
			char ch = formula.charAt(i);
			if (ch == '"' || ch == '\'') {
				i = quotedEnd(formula, i);
				continue;
			}
			if (!isWord(ch) || (i > 0 && isWord(formula.charAt(i - 1)))) {
				i++;
				continue;
			}
			int end = i;
			while (end < n && isWord(formula.charAt(end))) {
				end++;
			}
			int open = end;
			while (open < n && formula.charAt(open) == ' ') {
				open++;
			}
			String name = formula.substring(i, end).toUpperCase(Locale.ROOT);
			if (open >= n || formula.charAt(open) != '(' || !NOTE_READERS.contains(name)) {
				i = end;
				continue;
			}
			int arg = open + 1;
			while (arg < n && Character.isWhitespace(formula.charAt(arg))) {
				arg++;
			}
			if (arg < n && formula.charAt(arg) == '"') {
				int close = quotedEnd(formula, arg);
				int after = close;
				while (after < n && Character.isWhitespace(formula.charAt(after))) {
					after++;
				}
				boolean closed = close > arg + 1 && formula.charAt(close - 1) == '"';
				boolean whole = after < n && ",);".indexOf(formula.charAt(after)) >= 0;
				String target = closed ? linkTarget(formula.substring(arg + 1, close - 1).replace("\"\"", "\"")) : null;
				if (whole && target != null) {
					out.append(formula, copied, arg).append("[[").append(target).append("]]");
					copied = close;
					found = true;
				}
			}
			i = open + 1;
		}
		return found ? oneLine(out.append(formula, copied, n).toString()) : null;
	}

	/** A note's name as a wikilink target, or null when it cannot be one. */
	private static @Nullable String linkTarget(String text) {
		String target = text.strip();
		if (target.startsWith("[[") && target.endsWith("]]")) {
			target = target.substring(2, target.length() - 2);
		}
		int bar = target.indexOf('|');
		if (bar >= 0) {
			target = target.substring(0, bar);
		}
		target = target.strip();
		if (target.isEmpty() || target.chars().anyMatch((c) -> c == '[' || c == ']' || c == '|' || c == '#' || c == '\n' || c == '\r')) {
			return null;
		}
		return target;
	}

	private static boolean isWord(char ch) {
		return Character.isLetterOrDigit(ch) || ch == '_' || ch == '.' || ch == '$';
	}

	/** The end of a quoted run starting at {@code from} ({@code "…"} or {@code '…'}, the quote doubled inside). */
	private static int quotedEnd(String text, int from) {
		char quote = text.charAt(from);
		int i = from + 1;
		while (i < text.length()) {
			if (text.charAt(i) == quote) {
				if (i + 1 < text.length() && text.charAt(i + 1) == quote) {
					i += 2;
				}
				else {
					return i + 1;
				}
			}
			else {
				i++;
			}
		}
		return text.length();
	}

	/** A sortable row-major position for a cell key ({@code B10}, {@code b10}, {@code $B$10}), or -1. */
	static long position(String key) {
		Matcher m = CELL.matcher(key.strip().toUpperCase(Locale.ROOT).replace("$", ""));
		if (!m.matches()) {
			return -1;
		}
		long column = 0;
		for (char letter : m.group(1).toCharArray()) {
			column = column * 26 + (letter - 'A' + 1);
		}
		return Long.parseLong(m.group(2)) * 100_000 + column;
	}

	private static boolean isText(@Nullable JsonNode node, String expected) {
		return node != null && node.isString() && expected.equals(node.stringValue());
	}

	private static String oneLine(String text) {
		return text.replace('\r', ' ').replace('\n', ' ');
	}

}

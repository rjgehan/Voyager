package com.rjgehan.notes.settings;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * {@code settings.editor.noteWidth} (DESIGN §6.6): how wide a note's text runs, from {@link #MIN} to {@link #MAX} CSS
 * pixels, or the full width of the pane ({@link #FULL}). On the wire it is a number or {@code "full"}. It replaced the
 * on/off {@code readableLineLength}: on is {@link #READABLE}, the width that setting used, and off is {@link #FULL}.
 *
 * @param pixels the width, or 0 for the full width
 */
public record NoteWidth(int pixels) {

	public static final int MIN = 600;

	public static final int MAX = 1400;

	/** The wire value of {@link #FULL}. */
	public static final String FULL_WIRE = "full";

	/** The full width of the pane. */
	public static final NoteWidth FULL = new NoteWidth(0);

	/** The default, and what {@code readableLineLength: true} was. */
	public static final NoteWidth READABLE = new NoteWidth(MIN);

	public NoteWidth {
		if (pixels != 0 && (pixels < MIN || pixels > MAX)) {
			throw new IllegalArgumentException("A note width is " + MIN + " to " + MAX + " pixels, or full");
		}
	}

	public boolean isFull() {
		return this.pixels == 0;
	}

	/** {@code readableLineLength} as earlier builds wrote it. */
	public static NoteWidth fromReadableLineLength(boolean readable) {
		return readable ? READABLE : FULL;
	}

	@JsonValue
	public Object wire() {
		return isFull() ? FULL_WIRE : this.pixels;
	}

}

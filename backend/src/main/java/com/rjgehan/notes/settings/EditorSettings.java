package com.rjgehan.notes.settings;

/**
 * {@code settings.editor}: UI preferences that apply on every device.
 *
 * @param noteWidth how wide a note's text runs (it replaced {@code readableLineLength})
 */
public record EditorSettings(EditorMode defaultMode, NoteWidth noteWidth, boolean strictLineBreaks) {
}

package com.rjgehan.notes.share;

import com.rjgehan.notes.api.dto.ShareKind;
import org.jspecify.annotations.Nullable;

/**
 * What a share covers (DESIGN §5.40), as plain string comparisons on NFC vault paths that already passed the path
 * rules: a note share its own path, a folder share every path strictly under the folder. Case-sensitive, so a guest
 * never reaches a file by changing the case of a shared name.
 */
public final class ShareScope {

	private ShareScope() {
	}

	public static boolean contains(ShareKind kind, String root, String path) {
		return (kind == ShareKind.NOTE) ? path.equals(root) : (!root.isEmpty() && path.startsWith(root + "/"));
	}

	/**
	 * The share's path after a move of {@code from} to {@code to} (a file, or a folder and everything under it), or
	 * null when the move does not concern it.
	 */
	public static @Nullable String moved(String root, String from, String to) {
		if (root.equals(from)) {
			return to;
		}
		if (root.startsWith(from + "/")) {
			return to + root.substring(from.length());
		}
		return null;
	}

	/** True when {@code path} is the share's root or one of the folders above it. */
	public static boolean isRootOrAbove(String root, String path) {
		return root.equals(path) || root.startsWith(path + "/");
	}

}

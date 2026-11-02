package com.rjgehan.notes.share;

import com.rjgehan.notes.api.dto.ShareKind;
import com.rjgehan.notes.events.EventHub;
import com.rjgehan.notes.events.FileDeletedEvent;
import com.rjgehan.notes.events.FileEvent;
import com.rjgehan.notes.events.FolderDeletedEvent;
import com.rjgehan.notes.events.FolderEvent;
import com.rjgehan.notes.events.MovedEvent;
import com.rjgehan.notes.events.ResyncEvent;
import com.rjgehan.notes.events.ShareChangedEvent;
import com.rjgehan.notes.events.VaultEvent;
import org.jspecify.annotations.Nullable;

/**
 * A guest's event stream (DESIGN §5.40): file events of the share's scope and of the media its notes embed pass; a
 * move that the share followed, or one within the scope, passes as {@code entry.moved}; another move or a folder event
 * touching the scope becomes {@code share.changed}; {@code resync} passes; nothing else reaches a guest. The share is
 * looked up again for every event (it may have moved), and the stream stays open only while the grant still holds.
 */
public final class GuestEventFilter implements EventHub.ConnectionFilter {

	private final ShareAccess access;

	private final ShareService shares;

	private final ShareAccess.Grant grant;

	public GuestEventFilter(ShareAccess access, ShareService shares, ShareAccess.Grant grant) {
		this.access = access;
		this.shares = shares;
		this.grant = grant;
	}

	@Override
	public boolean open() {
		return this.access.stillValid(this.grant);
	}

	@Override
	public @Nullable VaultEvent map(VaultEvent event) {
		Share share = this.access.current(this.grant);
		if (share == null) {
			return null;
		}
		return switch (event) {
			case FileEvent file -> visible(share, file.file().path()) ? file : null;
			case FileDeletedEvent deleted -> share.contains(deleted.path()) ? deleted : null;
			case MovedEvent moved -> moved(share, moved);
			case FolderEvent folder -> (share.kind() == ShareKind.FOLDER && share.contains(folder.path())) ? folder
					: null;
			case FolderDeletedEvent folder -> share.contains(folder.path()) ? folder
					: ShareScope.isRootOrAbove(share.path(), folder.path()) ? new ShareChangedEvent() : null;
			case ResyncEvent resync -> resync;
			default -> null;
		};
	}

	private boolean visible(Share share, String path) {
		return share.contains(path) || this.shares.embeddedMedia(share).contains(path);
	}

	private static @Nullable VaultEvent moved(Share share, MovedEvent moved) {
		// The share followed the move (before or after ShareService.moved re-keyed it), or it happened inside.
		if (ShareScope.isRootOrAbove(share.path(), moved.from()) || ShareScope.isRootOrAbove(share.path(), moved.to())
				|| (share.contains(moved.from()) && share.contains(moved.to()))) {
			return moved;
		}
		if (share.contains(moved.from()) || share.contains(moved.to())) {
			return new ShareChangedEvent();
		}
		return null;
	}

}

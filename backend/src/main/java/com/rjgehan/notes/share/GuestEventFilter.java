package com.rjgehan.notes.share;

import com.rjgehan.notes.api.dto.EntryType;
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
 * <p>
 * Whether the share followed a move is judged from the path the filter last saw it at as well as its current one,
 * because the move's event can be mapped before or after {@link ShareService#moved} re-keys the share. A move onto the
 * path of a share whose note or folder is missing is not one it followed: the guest gets {@code share.changed} and
 * never the {@code from} path, which can be private.
 */
public final class GuestEventFilter implements EventHub.ConnectionFilter {

	private final ShareAccess access;

	private final ShareService shares;

	private final ShareAccess.Grant grant;

	/** The share's path at the previous event (or when the stream opened). */
	private volatile String lastPath;

	public GuestEventFilter(ShareAccess access, ShareService shares, ShareAccess.Grant grant) {
		this.access = access;
		this.shares = shares;
		this.grant = grant;
		this.lastPath = grant.share().path();
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
		String seen = this.lastPath;
		this.lastPath = share.path();
		return switch (event) {
			case FileEvent file -> visible(share, file.file().path()) ? file : null;
			case FileDeletedEvent deleted -> share.contains(deleted.path()) ? deleted : null;
			case MovedEvent moved -> moved(share, seen, moved);
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

	private static @Nullable VaultEvent moved(Share share, String seen, MovedEvent moved) {
		// The share followed the move: mapped before ShareService.moved re-keyed it (it is still under "from"), or
		// after (it was under "from" at the previous event and is now where the move put it). Or it happened inside.
		if (followed(share.path(), moved) || (followed(seen, moved)
				&& share.path().equals(ShareScope.moved(seen, moved.from(), moved.to())))
				|| (share.contains(moved.from()) && share.contains(moved.to()))) {
			return moved;
		}
		if (share.contains(moved.from()) || share.contains(moved.to())
				|| ShareScope.isRootOrAbove(share.path(), moved.from())
				|| ShareScope.isRootOrAbove(share.path(), moved.to())) {
			return new ShareChangedEvent();
		}
		return null;
	}

	/** True when a share at {@code path} follows the move, as {@link ShareService#moved} decides. */
	private static boolean followed(String path, MovedEvent moved) {
		return (moved.type() == EntryType.FILE) ? path.equals(moved.from())
				: ShareScope.moved(path, moved.from(), moved.to()) != null;
	}

}

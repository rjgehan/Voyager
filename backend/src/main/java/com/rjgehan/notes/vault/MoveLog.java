package com.rjgehan.notes.vault;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeMap;

import org.jspecify.annotations.Nullable;

import org.springframework.stereotype.Component;

/**
 * The per-boot record of moves made through the app, {@code lower(oldPath) → newPath} in the order they happened
 * (DESIGN §5.6). A save to a path that no longer exists gets {@code movedTo} from it, so a device that missed the
 * rename can follow the note. Chains are followed at lookup time, and only forward in time: a hop counts only when it
 * was recorded after the hop before it, so a move away from a name made before another note took that name is never
 * followed. The oldest entries are evicted beyond 10,000.
 */
@Component
public class MoveLog {

	static final int CAPACITY = 10_000;

	private static final int MAX_HOPS = 64;

	/** lower(from) → (sequence number → to), every move away from that name in this boot. */
	private final Map<String, TreeMap<Long, String>> moves = new HashMap<>();

	/** The keys in recording order, for eviction. */
	private final Deque<String> order = new ArrayDeque<>();

	private long seq;

	public synchronized void record(String from, String to) {
		String key = PathNames.lower(from);
		this.moves.computeIfAbsent(key, (k) -> new TreeMap<>()).put(++this.seq, to);
		this.order.addLast(key);
		while (this.order.size() > CAPACITY) {
			String eldest = this.order.removeFirst();
			TreeMap<Long, String> entries = this.moves.get(eldest);
			if (entries != null) {
				entries.pollFirstEntry();
				if (entries.isEmpty()) {
					this.moves.remove(eldest);
				}
			}
		}
	}

	/** Where {@code path} ended up after one or more moves in this boot, or null when it was not moved. */
	public synchronized @Nullable String movedTo(String path) {
		TreeMap<Long, String> first = this.moves.get(PathNames.lower(path));
		if (first == null) {
			return null;
		}
		// The device that saves to a moved path holds the note that was there first in this boot.
		Map.Entry<Long, String> hop = first.firstEntry();
		String current = hop.getValue();
		long at = hop.getKey();
		for (int hops = 0; hops < MAX_HOPS; hops++) {
			TreeMap<Long, String> later = this.moves.get(PathNames.lower(current));
			Map.Entry<Long, String> next = (later != null) ? later.higherEntry(at) : null;
			if (next == null) {
				break;
			}
			current = next.getValue();
			at = next.getKey();
		}
		// Exact: a case-only rename (meeting notes.md → Meeting notes.md) is a move a device must follow.
		return current.equals(path) ? null : current;
	}

}

package com.rjgehan.notes.share;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.vaults.ServerWide;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * The guests' rate limit (DESIGN §5.40): each refused guest request ({@code 404 share-not-found},
 * {@code 403 outside-share}, a path the vault's rules refuse) counts against its Tailscale login; after
 * {@link #MAX_FAILURES} within {@link #WINDOW}, every guest request of that login answers
 * {@code 429 too-many-attempts} until the oldest failure leaves the window. Server-wide, so every vault counts
 * together. Owners are never counted.
 */
@Component
@ServerWide
public class ShareRateLimiter {

	private static final Logger logger = LoggerFactory.getLogger(ShareRateLimiter.class);

	public static final int MAX_FAILURES = 20;

	public static final Duration WINDOW = Duration.ofMinutes(15);

	/** Beyond this many logins the map is pruned of logins without a failure in the window. */
	private static final int PRUNE_AT = 10_000;

	private final Clock clock;

	private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();

	@Autowired
	public ShareRateLimiter(Clock clock) {
		this.clock = clock;
	}

	/** Throws {@code 429 too-many-attempts} while {@code login} is locked out. */
	public void check(String login) {
		Deque<Instant> recent = this.failures.get(key(login));
		if (recent == null) {
			return;
		}
		Instant now = this.clock.instant();
		Instant retryAt;
		synchronized (recent) {
			prune(recent, now);
			if (recent.size() < MAX_FAILURES) {
				return;
			}
			retryAt = recent.peekFirst().plus(WINDOW);
		}
		throw tooMany(Math.max(1, Duration.between(now, retryAt).toSeconds() + 1));
	}

	/** Counts one refused request of {@code login}. */
	public void fail(String login) {
		Instant now = this.clock.instant();
		if (this.failures.size() > PRUNE_AT) {
			this.failures.entrySet().removeIf((entry) -> {
				synchronized (entry.getValue()) {
					prune(entry.getValue(), now);
					return entry.getValue().isEmpty();
				}
			});
		}
		Deque<Instant> recent = this.failures.computeIfAbsent(key(login), (k) -> new ArrayDeque<>());
		synchronized (recent) {
			prune(recent, now);
			recent.addLast(now);
			if (recent.size() == MAX_FAILURES) {
				logger.warn("SHARE_RATE_LIMITED: {} refused guest requests from {} in {} minutes; refusing its guest "
						+ "requests for a while", MAX_FAILURES, login, WINDOW.toMinutes());
			}
			while (recent.size() > MAX_FAILURES) {
				recent.removeFirst();
			}
		}
	}

	private static void prune(Deque<Instant> recent, Instant now) {
		Instant cutoff = now.minus(WINDOW);
		while (!recent.isEmpty() && !recent.peekFirst().isAfter(cutoff)) {
			recent.removeFirst();
		}
	}

	private static String key(String login) {
		return login.strip().toLowerCase(Locale.ROOT);
	}

	private static NotesException tooMany(long seconds) {
		NotesException ex = new NotesException(ErrorCode.TOO_MANY_ATTEMPTS,
				"Too many requests for shares or files this login may not open; try again later",
				Map.of("retryAfter", seconds));
		ex.getHeaders().set("Retry-After", Long.toString(seconds));
		return ex;
	}

}

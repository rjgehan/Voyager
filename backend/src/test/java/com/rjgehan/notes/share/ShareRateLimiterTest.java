package com.rjgehan.notes.share;

import java.time.Duration;

import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.support.TestVault;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

/** The guests' rate limit (DESIGN §5.40): 20 refusals in 15 minutes lock a login out until the oldest one expires. */
class ShareRateLimiterTest {

	@Test
	void twentyRefusalsLockALoginOutUntilTheOldestLeavesTheWindow() {
		TestVault.MutableClock clock = TestVault.newClock();
		ShareRateLimiter limiter = new ShareRateLimiter(clock);
		for (int i = 0; i < ShareRateLimiter.MAX_FAILURES - 1; i++) {
			limiter.fail("prober@example.com");
			clock.advance(Duration.ofSeconds(10));
		}
		assertThatCode(() -> limiter.check("prober@example.com")).doesNotThrowAnyException();
		limiter.fail("Prober@Example.com");
		NotesException locked = catchThrowableOfType(NotesException.class, () -> limiter.check("prober@example.com"));
		assertThat(locked.code()).isEqualTo(ErrorCode.TOO_MANY_ATTEMPTS);
		long retryAfter = Long.parseLong(locked.getHeaders().getFirst("Retry-After"));
		// The oldest refusal was 190 s ago: it leaves the window in 710 s.
		assertThat(retryAfter).isBetween(700L, 712L);
		assertThat(locked.getBody().getProperties()).containsEntry("retryAfter", retryAfter);
		// Another login is not affected.
		assertThatCode(() -> limiter.check("neighbour@example.com")).doesNotThrowAnyException();
		// Once the oldest refusal is out of the window, one more attempt is allowed.
		clock.advance(Duration.ofSeconds(retryAfter));
		assertThatCode(() -> limiter.check("prober@example.com")).doesNotThrowAnyException();
		limiter.fail("prober@example.com");
		assertThat(catchThrowableOfType(NotesException.class, () -> limiter.check("prober@example.com")).code())
			.isEqualTo(ErrorCode.TOO_MANY_ATTEMPTS);
		clock.advance(ShareRateLimiter.WINDOW);
		assertThatCode(() -> limiter.check("prober@example.com")).doesNotThrowAnyException();
	}

}

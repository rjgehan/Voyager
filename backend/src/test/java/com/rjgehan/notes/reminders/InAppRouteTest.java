package com.rjgehan.notes.reminders;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import com.rjgehan.notes.events.EventHub;
import com.rjgehan.notes.events.VaultEvent;
import com.rjgehan.notes.settings.RemindersSettings;
import com.rjgehan.notes.support.TestProperties;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import static org.assertj.core.api.Assertions.assertThat;

/** In-app reminders are accepted only while one of the owner's NotesApp tabs is connected (DESIGN §5.26). */
class InAppRouteTest {

	private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-02T14:00:00Z"), ZoneOffset.UTC);

	private static final ReminderMessage MESSAGE = new ReminderMessage("task:t1:2026-11-02T09:00", "task", "t1",
			"2026-11-02T09:00", "Water the plants", "Due 09:00", "/x/tasks/today?task=t1");

	/** A family member's share page: it sees file events of its share, never a reminder. */
	private static final EventHub.ConnectionFilter GUEST = new EventHub.ConnectionFilter() {

		@Override
		public @Nullable VaultEvent map(VaultEvent event) {
			return null;
		}

		@Override
		public boolean open() {
			return true;
		}

	};

	@Test
	void aGuestsSharePageIsNotAnOpenNotesAppTab() {
		EventHub hub = new EventHub(TestProperties.forVault(Path.of("vault"), Map.of()), CLOCK);
		InAppRoute route = new InAppRoute(hub, CLOCK);
		try {
			hub.connect(new SseEmitter(), "guest-client-1", null, GUEST);
			ReminderRoute.Delivery delivery = route.deliver(MESSAGE, RemindersSettings.defaults());
			// Not accepted, so the reminder is retried, or another route delivers it.
			assertThat(delivery.accepted()).isFalse();
			assertThat(delivery.error()).isEqualTo("no NotesApp tab is open");
			hub.connect(new SseEmitter(), "owner-client-1", null);
			assertThat(route.deliver(MESSAGE, RemindersSettings.defaults()).accepted()).isTrue();
		}
		finally {
			hub.closeAll();
		}
	}

}

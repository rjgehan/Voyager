package com.rjgehan.notes.reminders;

import java.time.Clock;

import com.rjgehan.notes.events.EventHub;
import com.rjgehan.notes.events.ReminderDueEvent;
import com.rjgehan.notes.settings.RemindersSettings;

import org.springframework.stereotype.Component;

/**
 * In-app reminders: a {@code reminder.due} event on the live-sync stream, which every open tab shows as a toast and a
 * browser notification. Accepted when at least one of the owner's tabs is connected (a family member's share page
 * does not count), so with every tab closed another route (or the next tick, once a tab is open again) delivers it.
 */
@Component
public class InAppRoute implements ReminderRoute {

	private final EventHub hub;

	private final Clock clock;

	public InAppRoute(EventHub hub, Clock clock) {
		this.hub = hub;
		this.clock = clock;
	}

	@Override
	public String id() {
		return "inApp";
	}

	@Override
	public boolean enabled(RemindersSettings settings) {
		return settings.inApp();
	}

	@Override
	public Delivery deliver(ReminderMessage message, RemindersSettings settings) {
		// A guest's share page holds a stream too, but never shows a reminder: only the owner's tabs count.
		if (this.hub.ownerConnectionCount() == 0) {
			return Delivery.failed("no Voyager tab is open");
		}
		this.hub.publish(new ReminderDueEvent(message.key(), message.kind(), message.taskId(), message.at(),
				message.title(), message.body(), message.url(), this.clock.instant()));
		return Delivery.ACCEPTED;
	}

}

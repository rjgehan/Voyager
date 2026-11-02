package com.rjgehan.notes.events;

/**
 * {@code share.changed}, on a guest's stream only (DESIGN §5.40): something moved into, out of or within the share in
 * a way the guest's page cannot patch, so it refetches the share. Never published to the hub: a guest connection's
 * filter makes it from the event it replaces.
 */
public record ShareChangedEvent() implements VaultEvent {

	@Override
	public String eventName() {
		return "share.changed";
	}

}

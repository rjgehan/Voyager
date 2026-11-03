package com.rjgehan.notes.config;

import java.util.List;
import java.util.Locale;
import java.util.function.Predicate;

import org.jspecify.annotations.Nullable;

/**
 * The host the app is served on, from {@code notes.allowed-hosts}, for links that leave the app (a tapped ntfy
 * reminder, an app alert, DESIGN §5.18 and §5.26): the first eligible entry, except that a name also listed with a
 * port is served on that port. The CasaOS layout lists {@code homeserver.<tailnet>.ts.net} and
 * {@code homeserver.<tailnet>.ts.net:8443} because {@code tailscale serve} answers on 8443 when another app has 443;
 * a browser sends the port in {@code Host} only for a port other than 443, so the entry with the port is the one in
 * use.
 */
public final class ServedHost {

	private ServedHost() {
	}

	/** The host (with its port, if any) for {@code https://}, or null when no entry is eligible. */
	public static @Nullable String of(List<String> allowedHosts, Predicate<String> eligible) {
		String first = null;
		for (String host : allowedHosts) {
			String h = host.strip();
			if (!h.isEmpty() && eligible.test(h)) {
				first = h;
				break;
			}
		}
		if (first == null || first.indexOf(':') >= 0) {
			return first;
		}
		String prefix = first.toLowerCase(Locale.ROOT) + ":";
		for (String host : allowedHosts) {
			String h = host.strip();
			if (h.length() > prefix.length() && h.toLowerCase(Locale.ROOT).startsWith(prefix)) {
				return h;
			}
		}
		return first;
	}

}

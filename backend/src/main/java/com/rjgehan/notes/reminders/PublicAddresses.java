package com.rjgehan.notes.reminders;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.regex.Pattern;

import org.jspecify.annotations.Nullable;

/**
 * The addresses a Web Push endpoint may have (security audit of 2026-11-02, docs/SECURITY.md finding F4). Push
 * services (FCM, Mozilla autopush, Apple, Windows) are on the public internet, and the endpoint is the one destination
 * of a server-side request that an API caller chooses; so an endpoint on this machine, the LAN, the Docker networks,
 * the tailnet or any other non-public range is refused, before anything is sent. Without that, any admitted caller
 * could make the server post to services only the server can reach, and read their answers' kind (connection refused,
 * TLS error, HTTP status) through the reminders test.
 */
final class PublicAddresses {

	private static final Pattern IPV4_LITERAL = Pattern.compile("[0-9.]+");

	private PublicAddresses() {
	}

	/** True when {@code address} is routable on the public internet. */
	static boolean isPublic(InetAddress address) {
		if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
				|| address.isSiteLocalAddress() || address.isMulticastAddress()) {
			return false;
		}
		byte[] b = address.getAddress();
		if (b.length == 4) {
			return isPublicV4(b, 0);
		}
		int b0 = b[0] & 0xff;
		int b1 = b[1] & 0xff;
		if ((b0 & 0xfe) == 0xfc) {
			// fc00::/7, unique local addresses (Tailscale's fd7a:115c:a1e0::/48 among them)
			return false;
		}
		if (b0 == 0x20 && b1 == 0x01 && (b[2] & 0xff) == 0x0d && (b[3] & 0xff) == 0xb8) {
			// 2001:db8::/32, documentation
			return false;
		}
		if (b0 == 0x20 && b1 == 0x02) {
			// 2002::/16, 6to4: the IPv4 address in bytes 2 to 5
			return isPublicV4(b, 2);
		}
		if (b0 == 0x00 && b1 == 0x64 && (b[2] & 0xff) == 0xff && (b[3] & 0xff) == 0x9b) {
			// 64:ff9b::/96, NAT64: the IPv4 address in the last four bytes
			return isPublicV4(b, 12);
		}
		boolean leadingZeros = true;
		for (int i = 0; i < 12; i++) {
			leadingZeros &= b[i] == 0;
		}
		// ::a.b.c.d, IPv4-compatible (IPv4-mapped ones are already Inet4Address)
		return !leadingZeros || isPublicV4(b, 12);
	}

	private static boolean isPublicV4(byte[] b, int at) {
		int b0 = b[at] & 0xff;
		int b1 = b[at + 1] & 0xff;
		int b2 = b[at + 2] & 0xff;
		if (b0 == 0 || b0 == 10 || b0 == 127 || b0 >= 224) {
			// this network, private, loopback, multicast and reserved
			return false;
		}
		if (b0 == 100 && (b1 & 0xc0) == 64) {
			// 100.64.0.0/10, shared address space: carrier-grade NAT and every Tailscale address
			return false;
		}
		if ((b0 == 169 && b1 == 254) || (b0 == 172 && (b1 & 0xf0) == 16) || (b0 == 192 && b1 == 168)) {
			// link-local (cloud metadata services among them) and private
			return false;
		}
		if ((b0 == 192 && b1 == 0 && (b2 == 0 || b2 == 2)) || (b0 == 198 && (b1 & 0xfe) == 18)
				|| (b0 == 198 && b1 == 51 && b2 == 100) || (b0 == 203 && b1 == 0 && b2 == 113)) {
			// protocol assignments, benchmarking and documentation
			return false;
		}
		return true;
	}

	/**
	 * Why a push endpoint's host is refused without looking it up, or null: a {@code localhost} name, or an IP literal
	 * that is not public. Names are checked when a message is sent ({@link WebPushSender}), on what they resolve to.
	 */
	static @Nullable String hostError(String host) {
		String h = host.toLowerCase(Locale.ROOT);
		if (h.startsWith("[") && h.endsWith("]")) {
			h = h.substring(1, h.length() - 1);
		}
		if (h.endsWith(".")) {
			h = h.substring(0, h.length() - 1);
		}
		if (h.equals("localhost") || h.endsWith(".localhost")) {
			return "endpoint must be a push service on the internet, not this machine";
		}
		if (h.contains(":") || IPV4_LITERAL.matcher(h).matches()) {
			try {
				// A literal: no lookup happens.
				if (!isPublic(InetAddress.getByName(h))) {
					return "endpoint must be a push service on the internet, not a private or local address";
				}
			}
			catch (UnknownHostException ex) {
				return "endpoint has an invalid address";
			}
		}
		return null;
	}

}

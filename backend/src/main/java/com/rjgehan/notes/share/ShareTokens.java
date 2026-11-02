package com.rjgehan.notes.share;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * Share ids, capability-link tokens and their hashes (DESIGN §5.40). An id is 12 random lower-case letters and digits
 * and names a share; a token is 32 random bytes in unpadded base64url (43 characters) and is a secret, of which only
 * the SHA-256 is ever stored. The two never have the same length, so a key's shape says which one it is.
 */
public final class ShareTokens {

	public static final Pattern ID = Pattern.compile("[a-z0-9]{12}");

	public static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");

	public static final Pattern HASH = Pattern.compile("[0-9a-f]{64}");

	private static final String ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

	private static final SecureRandom RANDOM = new SecureRandom();

	private ShareTokens() {
	}

	public static String newId() {
		StringBuilder out = new StringBuilder(12);
		for (int i = 0; i < 12; i++) {
			out.append(ID_ALPHABET.charAt(RANDOM.nextInt(ID_ALPHABET.length())));
		}
		return out.toString();
	}

	public static String newToken() {
		byte[] bytes = new byte[32];
		RANDOM.nextBytes(bytes);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
	}

	/** The lower-case hex SHA-256 of a token's characters. */
	public static String hash(String token) {
		try {
			byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII));
			return HexFormat.of().formatHex(digest);
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("SHA-256 is not available", ex);
		}
	}

	/** Compares two hashes in time that does not depend on where they differ. */
	public static boolean sameHash(String a, String b) {
		return MessageDigest.isEqual(a.getBytes(StandardCharsets.US_ASCII), b.getBytes(StandardCharsets.US_ASCII));
	}

	public static boolean isId(String key) {
		return ID.matcher(key).matches();
	}

	public static boolean isToken(String key) {
		return TOKEN.matcher(key).matches();
	}

}

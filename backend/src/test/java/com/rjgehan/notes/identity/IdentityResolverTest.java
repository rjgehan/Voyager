package com.rjgehan.notes.identity;

import java.nio.file.Path;
import java.util.Map;

import com.rjgehan.notes.support.TestProperties;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IdentityResolverTest {

	private static IdentityResolver resolver(Map<String, String> properties) {
		return new IdentityResolver(TestProperties.forVault(Path.of("vault"), properties));
	}

	@Test
	void tailscaleHeadersBecomeTheIdentity() {
		Identity identity = resolver(Map.of()).resolve("octocat@github", "=?utf-8?q?Ren=C3=A9?=",
				"https://avatars.example/u/1");
		assertThat(identity).isEqualTo(new Identity("octocat@github", "René", "https://avatars.example/u/1",
				Identity.Source.TAILSCALE));
	}

	@Test
	void emptyProfilePictureBecomesNullAndMissingNameFallsBackToLogin() {
		Identity identity = resolver(Map.of()).resolve("someone@github", null, "");
		assertThat(identity.profilePicUrl()).isNull();
		assertThat(identity.name()).isEqualTo("someone@github");
	}

	@Test
	void missingLoginIsRefusedUnlessDefaultsAreAllowed() {
		assertThat(resolver(Map.of()).resolve(null, null, null)).isNull();
		assertThat(resolver(Map.of()).resolve("  ", null, null)).isNull();
		Identity fallback = resolver(Map.of("notes.identity.allow-default", "true")).resolve(null, null, null);
		assertThat(fallback).isEqualTo(new Identity("owner@notes", "Owner", null, Identity.Source.DEFAULT));
	}

	@Test
	void loginsOutsideTheAllowlistAreRefused() {
		IdentityResolver resolver = resolver(Map.of("notes.identity.allowed-logins", "octocat@github"));
		assertThat(resolver.resolve("octocat@github", "R", null)).isNotNull();
		assertThat(resolver.resolve("OctoCat@GitHub", "R", null)).isNotNull();
		assertThat(resolver.resolve("intruder@github", "I", null)).isNull();
	}

	@Test
	void theAllowlistNamesTheOwnersAndEveryOtherLoginIsAGuest() {
		IdentityResolver resolver = resolver(Map.of("notes.identity.allowed-logins", "octocat@github, partner@github"));
		assertThat(resolver.hasOwnerList()).isTrue();
		Identity guest = resolver.resolveAny("mom@example.com", "=?utf-8?q?Mam=C3=A1?=", null);
		assertThat(guest).isEqualTo(new Identity("mom@example.com", "Mamá", null, Identity.Source.TAILSCALE));
		assertThat(resolver.isOwner(guest)).isFalse();
		assertThat(resolver.isOwner(resolver.resolveAny("Partner@GitHub", null, null))).isTrue();
		assertThat(resolver.resolveAny(null, null, null)).isNull();
		assertThat(resolver.resolveAny("  ", null, null)).isNull();
	}

	@Test
	void withoutAnOwnerListEveryLoginIsAnOwnerAndTheDefaultIdentityAlwaysIs() {
		IdentityResolver open = resolver(Map.of());
		assertThat(open.hasOwnerList()).isFalse();
		assertThat(open.isOwner(open.resolveAny("anyone@example.com", null, null))).isTrue();
		IdentityResolver dev = resolver(
				Map.of("notes.identity.allow-default", "true", "notes.identity.allowed-logins", "octocat@github"));
		Identity fallback = dev.resolveAny(null, null, null);
		assertThat(fallback.source()).isEqualTo(Identity.Source.DEFAULT);
		assertThat(dev.isOwner(fallback)).isTrue();
		assertThat(dev.isOwner(dev.resolveAny("mom@example.com", null, null))).isFalse();
	}

}

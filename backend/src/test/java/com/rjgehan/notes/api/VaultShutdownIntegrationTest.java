package com.rjgehan.notes.api;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

import com.rjgehan.notes.support.Api;
import com.rjgehan.notes.support.IntegrationProperties;
import com.rjgehan.notes.support.NotesIntegrationTest;
import com.rjgehan.notes.vaults.VaultRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.client.RestTestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * An extra vault while the server shuts down (DESIGN §5.39): its context closes when the main one starts to, before
 * the web server stops taking requests, and the requests of that window are told to retry, so a save on a phone
 * during a deploy is retried instead of failing for good.
 */
@NotesIntegrationTest
class VaultShutdownIntegrationTest {

	@TempDir
	static Path vault;

	@TempDir
	static Path vaults;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		IntegrationProperties.register(registry, () -> vault);
		registry.add("notes.vaults.dir", () -> {
			try {
				Files.createDirectories(vaults.resolve("work"));
			}
			catch (IOException ex) {
				throw new UncheckedIOException(ex);
			}
			return vaults.toString();
		});
	}

	@Autowired
	RestTestClient client;

	@Autowired
	VaultRegistry registry;

	@Test
	void anExtraVaultClosingWithTheServerAsksForARetry() {
		Api api = new Api(this.client);
		await().atMost(Duration.ofSeconds(60)).until(() -> this.registry.context("work") != null);
		api.get("/api/v/work/tree").ok(200);

		// What the main context's ContextClosedEvent does, while the web server still serves requests.
		this.registry.destroy();

		Api.Reply reply = api.get("/api/v/work/tree");
		assertThat(reply.status()).isEqualTo(503);
		assertThat(reply.json().get("code").asString()).isEqualTo("vault-unavailable");
		assertThat(reply.json().get("reason").asString()).isEqualTo("stopping");
		assertThat(reply.header("Retry-After")).isEqualTo("2");
		api.get("/api/tree").ok(200);
	}

}

package com.rjgehan.notes.ops;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.snakeyaml.engine.v2.api.Load;
import org.snakeyaml.engine.v2.api.LoadSettings;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The CasaOS simple layout as shipped (docs/CASAOS.md, docs/SECURITY.md §3.2, finding F5): the app shares the host's
 * network and listens on the host's loopback only, so nothing on the LAN or the tailnet can connect to it and forge
 * the identity headers; {@code tailscale serve} on the host still reaches {@code http://127.0.0.1:18095}. The optional
 * Whisper app does the same, and the image's health check follows the port.
 */
class CasaOsLayoutTest {

	private static final Path ROOT = Path.of("..");

	@Test
	void theAppListensOnTheHostsLoopbackAndPublishesNoPort() throws Exception {
		String text = read("deploy/casaos-compose.yml");
		Map<String, Object> notes = service(text, "notes");
		assertThat(notes).containsEntry("network_mode", "host").doesNotContainKey("ports").doesNotContainKey("networks");
		Map<String, Object> env = map(notes.get("environment"));
		assertThat(env).containsEntry("SERVER_ADDRESS", "127.0.0.1").containsEntry("SERVER_PORT", "18095");
		// What the file tells the user to run on the host matches.
		assertThat(text).contains("#   sudo tailscale serve --bg --https=8443 http://127.0.0.1:18095\n");
	}

	@Test
	void theHostNamesAndTheAllowedLoginsAreSet() throws Exception {
		Map<String, Object> env = map(service(read("deploy/casaos-compose.yml"), "notes").get("environment"));
		assertThat(String.valueOf(env.get("NOTES_ALLOWED_HOSTS")).split(","))
			.containsExactly("homeserver.<tailnet>.ts.net", "homeserver.<tailnet>.ts.net:8443");
		// Required: a placeholder the user replaces with their login (it admits nobody), never left out.
		assertThat(env.get("NOTES_IDENTITY_ALLOWED_LOGINS")).isEqualTo("you@example.com");
	}

	@Test
	void noCasaOsAppPublishesAPort() throws Exception {
		for (String file : List.of("deploy/casaos-compose.yml", "deploy/casaos-whisper-compose.yml",
				"deploy/casaos-backup-compose.yml", "deploy/casaos-compose-sidecar.yml")) {
			Map<String, Object> services = map(compose(read(file)).get("services"));
			services.forEach((name, service) -> assertThat(map(service)).as(file + " " + name).doesNotContainKey("ports"));
		}
	}

	@Test
	void transcriptionListensOnTheLoopbackWhereTheAppReachesIt() throws Exception {
		Map<String, Object> whisper = service(read("deploy/casaos-whisper-compose.yml"), "whisper");
		assertThat(whisper).containsEntry("network_mode", "host").doesNotContainKey("networks");
		assertThat(whisper.get("command")).isEqualTo(List.of("--host", "127.0.0.1", "--port", "18097"));
		assertThat(read("deploy/casaos-compose.yml")).contains("installed, http://127.0.0.1:18097.");
	}

	@Test
	void theImagesHealthCheckFollowsTheServerPort() throws Exception {
		assertThat(read("Dockerfile")).contains("CMD curl -fsS \"http://127.0.0.1:${SERVER_PORT:-8080}/readyz\" || exit 1\n");
	}

	private static String read(String path) throws Exception {
		return Files.readString(ROOT.resolve(path)).replace("\r\n", "\n");
	}

	private static Map<String, Object> compose(String text) {
		return map(new Load(LoadSettings.builder().build()).loadFromString(text));
	}

	private static Map<String, Object> service(String text, String name) {
		return map(map(compose(text).get("services")).get(name));
	}

	@SuppressWarnings("unchecked")
	private static Map<String, Object> map(Object value) {
		assertThat(value).isInstanceOf(Map.class);
		return (Map<String, Object>) value;
	}

}

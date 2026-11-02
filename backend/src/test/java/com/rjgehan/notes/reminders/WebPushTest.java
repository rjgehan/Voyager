package com.rjgehan.notes.reminders;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import com.rjgehan.notes.settings.RemindersSettings;
import com.rjgehan.notes.support.TestVault;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static com.rjgehan.notes.reminders.WebPushCrypto.base64Url;
import static com.rjgehan.notes.reminders.WebPushCrypto.fromBase64Url;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The Web Push route end to end against a local server standing in for a push service: the store in
 * {@code push.json}, the VAPID header, a body the subscription's key decrypts, and expired subscriptions dropped.
 */
class WebPushTest {

	private static final JsonMapper MAPPER = JsonMapper.builder().build();

	@TempDir
	Path dir;

	private HttpServer server;

	private final List<Map<String, String>> headers = new CopyOnWriteArrayList<>();

	private final List<byte[]> bodies = new CopyOnWriteArrayList<>();

	private volatile int status = 201;

	@BeforeEach
	void start() throws IOException {
		this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		this.server.createContext("/", (exchange) -> {
			this.bodies.add(exchange.getRequestBody().readAllBytes());
			this.headers.add(Map.of("authorization", exchange.getRequestHeaders().getFirst("Authorization"), "ttl",
					exchange.getRequestHeaders().getFirst("TTL"), "encoding",
					exchange.getRequestHeaders().getFirst("Content-Encoding"), "urgency",
					exchange.getRequestHeaders().getFirst("Urgency"), "topic",
					String.valueOf(exchange.getRequestHeaders().getFirst("Topic"))));
			exchange.sendResponseHeaders(this.status, -1);
			exchange.close();
		});
		this.server.start();
	}

	@AfterEach
	void stop() {
		this.server.stop(0);
	}

	private String localEndpoint() {
		return "http://127.0.0.1:" + this.server.getAddress().getPort() + "/push/abc";
	}

	@Test
	void theStoreValidatesSubscriptionsAndKeepsThemInPushJson() throws Exception {
		PushStore store = new PushStore(this.dir.resolve("secrets/push.json"), MAPPER);
		assertThat(store.vapid()).isNull();
		assertThat(store.problem()).isNull();
		KeyPair device = WebPushCrypto.generateKeyPair();
		String p256dh = base64Url(WebPushCrypto.encodePublic((ECPublicKey) device.getPublic()));
		String auth = base64Url(new byte[16]);

		assertThatThrownBy(() -> store.subscribe("http://push.example.com/x", p256dh, auth, "Phone", Instant.EPOCH))
			.hasMessageContaining("https");
		assertThatThrownBy(() -> store.subscribe("https://push.example.com/x", "AAAA", auth, "Phone", Instant.EPOCH))
			.hasMessageContaining("p256dh");
		assertThatThrownBy(
				() -> store.subscribe("https://push.example.com/x", p256dh, base64Url(new byte[8]), "x", Instant.EPOCH))
			.hasMessageContaining("auth");

		PushStore.Subscription first = store.subscribe("https://push.example.com/x", p256dh, auth, "iPhone\n",
				Instant.parse("2026-10-16T12:00:00Z"));
		assertThat(first.name()).isEqualTo("iPhone");
		PushStore.Subscription again = store.subscribe("https://push.example.com/x", p256dh, auth, "iPhone 17",
				Instant.parse("2026-10-17T12:00:00Z"));
		assertThat(again.id()).isEqualTo(first.id());
		assertThat(again.createdAt()).isEqualTo(Instant.parse("2026-10-16T12:00:00Z"));
		assertThat(store.subscriptions()).hasSize(1);
		String publicKey = store.vapid().publicKey();

		PushStore reread = new PushStore(this.dir.resolve("secrets/push.json"), MAPPER);
		assertThat(reread.vapid().publicKey()).isEqualTo(publicKey);
		assertThat(reread.ensureVapid().publicKey()).isEqualTo(publicKey);
		assertThat(reread.subscriptions()).extracting(PushStore.Subscription::name).containsExactly("iPhone 17");
		assertThat(Files.readString(this.dir.resolve("secrets/push.json"))).contains("privateKey");
		assertThat(reread.remove(first.id())).isTrue();
		assertThat(reread.remove(first.id())).isFalse();
		assertThat(new PushStore(this.dir.resolve("secrets/push.json"), MAPPER).subscriptions()).isEmpty();
	}

	@Test
	void theKeyFileAndASecretsFolderTheAppCreatesAreTheOwnersAlone() throws Exception {
		// Security audit (docs/SECURITY.md, F8): created owner-only, never readable by others even for a moment.
		org.junit.jupiter.api.Assumptions
			.assumeTrue(this.dir.getFileSystem().supportedFileAttributeViews().contains("posix"));
		PushStore store = new PushStore(this.dir.resolve("new-secrets/push.json"), MAPPER);
		store.ensureVapid();
		assertThat(java.nio.file.attribute.PosixFilePermissions
			.toString(Files.getPosixFilePermissions(this.dir.resolve("new-secrets")))).isEqualTo("rwx------");
		assertThat(java.nio.file.attribute.PosixFilePermissions
			.toString(Files.getPosixFilePermissions(this.dir.resolve("new-secrets/push.json")))).isEqualTo("rw-------");
	}

	@Test
	void aMalformedFileMakesWebPushUnavailable() throws Exception {
		Files.writeString(this.dir.resolve("push.json"), "[1]");
		PushStore store = new PushStore(this.dir.resolve("push.json"), MAPPER);
		assertThat(store.problem()).isEqualTo("push.json must hold a JSON object");
		assertThatThrownBy(store::ensureVapid).isInstanceOf(IOException.class);
	}

	@Test
	void aReminderIsEncryptedForEachDeviceWithAVapidHeader() throws Exception {
		PushStore store = new PushStore(this.dir.resolve("push.json"), MAPPER);
		KeyPair device = WebPushCrypto.generateKeyPair();
		byte[] auth = new byte[16];
		auth[0] = 9;
		// The store wants https; the test's push service is local http, so the file is written by hand.
		PushStore.Vapid vapid = store.ensureVapid();
		tools.jackson.databind.node.ObjectNode root = (tools.jackson.databind.node.ObjectNode) MAPPER
			.readTree(Files.readAllBytes(this.dir.resolve("push.json")));
		root.putArray("subscriptions")
			.addObject()
			.put("endpoint", localEndpoint())
			.put("p256dh", base64Url(WebPushCrypto.encodePublic((ECPublicKey) device.getPublic())))
			.put("auth", base64Url(auth))
			.put("name", "Phone");
		Files.write(this.dir.resolve("push.json"), MAPPER.writeValueAsBytes(root));
		store = new PushStore(this.dir.resolve("push.json"), MAPPER);
		assertThat(store.subscriptions()).hasSize(1);
		// The test's push service is on this machine, which the real sender refuses: no address check here.
		WebPushRoute route = new WebPushRoute(store, new WebPushSender(null)::send, MAPPER, TestVault.newClock(),
				"https://notes.example.ts.net");

		ReminderMessage message = new ReminderMessage("task:t1:2026-10-16T12:05", "task", "t1", "2026-10-16T12:05",
				"Pay rent", "Due 2026-10-16", "/x/tasks/today?task=t1");
		assertThat(route.deliver(message, RemindersSettings.defaults()).accepted()).isTrue();

		Map<String, String> sent = this.headers.get(0);
		assertThat(sent.get("ttl")).isEqualTo("86400");
		assertThat(sent.get("encoding")).isEqualTo("aes128gcm");
		assertThat(sent.get("urgency")).isEqualTo("high");
		assertThat(sent.get("topic")).isEqualTo(WebPushRoute.topic(message.key())).hasSize(16);
		String authorization = sent.get("authorization");
		assertThat(authorization).startsWith("vapid t=").endsWith(", k=" + vapid.publicKey());
		String jwt = authorization.substring("vapid t=".length(), authorization.indexOf(','));
		String[] parts = jwt.split("\\.");
		JsonNode claims = MAPPER.readTree(fromBase64Url(parts[1]));
		assertThat(claims.get("aud").asString()).isEqualTo("http://127.0.0.1:" + this.server.getAddress().getPort());
		assertThat(claims.get("sub").asString()).isEqualTo("https://notes.example.ts.net");
		assertThat(claims.get("exp").asLong()).isEqualTo(Instant.parse("2026-10-16T12:00:00Z").getEpochSecond() + 43200);
		Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
		verifier.initVerify(vapid.keyPair().getPublic());
		verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
		assertThat(verifier.verify(fromBase64Url(parts[2]))).isTrue();

		JsonNode payload = MAPPER.readTree(WebPushCrypto.decrypt(this.bodies.get(0), device, auth));
		assertThat(payload.get("title").asString()).isEqualTo("Pay rent");
		assertThat(payload.get("body").asString()).isEqualTo("Due 2026-10-16");
		assertThat(payload.get("tag").asString()).isEqualTo("task:t1:2026-10-16T12:05");
		assertThat(payload.get("url").asString()).isEqualTo("/x/tasks/today?task=t1");
		assertThat(payload.get("taskId").asString()).isEqualTo("t1");
		assertThat(payload.get("at").asString()).isEqualTo("2026-10-16T12:05");
		assertThat(store.subscriptions().get(0).lastSuccessAt()).isEqualTo(Instant.parse("2026-10-16T12:00:00Z"));

		this.status = 500;
		ReminderRoute.Delivery failed = route.deliver(message, RemindersSettings.defaults());
		assertThat(failed.accepted()).isFalse();
		assertThat(failed.error()).isEqualTo("Phone: the push service answered HTTP 500");
		assertThat(store.subscriptions().get(0).lastError()).isEqualTo("the push service answered HTTP 500");

		this.status = 410;
		assertThat(route.deliver(message, RemindersSettings.defaults()).accepted()).isFalse();
		assertThat(store.subscriptions()).isEmpty();
		assertThat(route.deliver(message, RemindersSettings.defaults()).error()).isEqualTo("no device is subscribed");
	}

	@Test
	void eachVaultsDailyNudgeHasItsOwnTagAndTopic() throws Exception {
		PushStore store = new PushStore(this.dir.resolve("push.json"), MAPPER);
		WebPushRoute.Sender none = (subscription, payload, vapid, subject, topic, now) -> {
			throw new AssertionError("nothing is sent");
		};
		WebPushRoute main = new WebPushRoute(store, none, MAPPER, TestVault.newClock(), "mailto:a@b.invalid", "");
		WebPushRoute work = new WebPushRoute(store, none, MAPPER, TestVault.newClock(), "mailto:a@b.invalid",
				"/v/work");
		ReminderMessage nudge = new ReminderMessage("daily:2026-10-16", "daily", null, null, "Today’s daily note",
				"Start today’s daily note.", "/?open=daily");
		assertThat(MAPPER.readTree(main.payload(nudge)).get("tag").asString()).isEqualTo("daily:2026-10-16");
		assertThat(MAPPER.readTree(work.payload(nudge)).get("tag").asString()).isEqualTo("v/work:daily:2026-10-16");
		assertThat(WebPushRoute.topic(work.tag(nudge.key()))).isNotEqualTo(WebPushRoute.topic(main.tag(nudge.key())))
			.hasSize(16);
	}

	@Test
	void subscriptionsToThisMachineThePrivateNetworksOrTheTailnetAreRefused() throws Exception {
		// Security audit (docs/SECURITY.md, F4): the endpoint is the one destination an API caller picks.
		PushStore store = new PushStore(this.dir.resolve("push.json"), MAPPER);
		KeyPair device = WebPushCrypto.generateKeyPair();
		String p256dh = base64Url(WebPushCrypto.encodePublic((ECPublicKey) device.getPublic()));
		String auth = base64Url(new byte[16]);
		for (String endpoint : List.of("https://localhost/x", "https://notes.localhost/x", "https://127.0.0.1:8080/x",
				"https://[::1]/x", "https://0.0.0.0/x", "https://10.1.2.3/x", "https://172.17.0.1:2375/x",
				"https://192.168.1.1/x", "https://169.254.169.254/latest/meta-data/", "https://100.101.102.103/x",
				"https://[fd7a:115c:a1e0::1]/x", "https://[fe80::1]/x", "https://[::ffff:10.0.0.1]/x",
				"https://[64:ff9b::a00:1]/x", "https://[2002:c0a8:101::1]/x", "https://2130706433/x")) {
			assertThatThrownBy(() -> store.subscribe(endpoint, p256dh, auth, "Phone", Instant.EPOCH)).as(endpoint)
				.isInstanceOf(PushStore.InvalidSubscriptionException.class)
				.hasMessageContaining("endpoint");
		}
		assertThat(store.subscribe("https://fcm.googleapis.com/fcm/send/abc", p256dh, auth, "Phone", Instant.EPOCH))
			.isNotNull();
		assertThat(store.subscribe("https://[2001:4860:4860::8888]/x", p256dh, auth, "Phone", Instant.EPOCH)).isNotNull();
	}

	@Test
	void nothingIsSentToAnEndpointThatResolvesToAPrivateAddress() throws Exception {
		PushStore store = new PushStore(this.dir.resolve("push.json"), MAPPER);
		KeyPair device = WebPushCrypto.generateKeyPair();
		PushStore.Vapid vapid = store.ensureVapid();
		String p256dh = base64Url(WebPushCrypto.encodePublic((ECPublicKey) device.getPublic()));
		// Written by hand, as by an older version or a hand edit: the check at send time is the one that counts.
		PushStore.Subscription local = new PushStore.Subscription("id1", localEndpoint(), p256dh,
				base64Url(new byte[16]), "Phone", Instant.EPOCH, null, null, null);
		WebPushSender.Result direct = new WebPushSender().send(local, new byte[] { 1 }, vapid,
				"https://notes.example.ts.net", null, Instant.EPOCH);
		assertThat(direct.delivered()).isFalse();
		assertThat(direct.error()).isEqualTo(WebPushSender.NOT_PUBLIC);

		// A name is judged by what it resolves to (here, a rebinding name that points at the LAN).
		PushStore.Subscription named = new PushStore.Subscription("id2",
				"http://push.rebind.example:" + this.server.getAddress().getPort() + "/push/abc", p256dh,
				base64Url(new byte[16]), "Phone", Instant.EPOCH, null, null, null);
		WebPushSender rebinding = new WebPushSender((host) -> new java.net.InetAddress[] {
				java.net.InetAddress.getByName("93.184.215.14"), java.net.InetAddress.getByName("192.168.1.20") });
		assertThat(rebinding.send(named, new byte[] { 1 }, vapid, "https://notes.example.ts.net", null, Instant.EPOCH)
			.error()).isEqualTo(WebPushSender.NOT_PUBLIC);
		assertThat(this.bodies).isEmpty();
	}

	@Test
	void onlyPublicAddressesArePublic() throws Exception {
		for (String address : List.of("127.0.0.1", "10.0.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254",
				"100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1",
				"::1", "::", "fe80::1", "fec0::1", "fc00::1", "fd7a:115c:a1e0::53", "ff02::1", "::ffff:127.0.0.1",
				"::127.0.0.1", "64:ff9b::7f00:1", "2002:a00:1::", "2001:db8::1")) {
			assertThat(PublicAddresses.isPublic(java.net.InetAddress.getByName(address))).as(address).isFalse();
		}
		for (String address : List.of("8.8.8.8", "142.250.80.10", "100.63.255.255", "100.128.0.1", "172.32.0.1",
				"2001:4860:4860::8888", "2a00:1450:4001::200e", "64:ff9b::808:808", "2002:808:808::")) {
			assertThat(PublicAddresses.isPublic(java.net.InetAddress.getByName(address))).as(address).isTrue();
		}
	}

	@Test
	void theNtfyRouteSendsTheTitleOnlyUnlessToldOtherwise() {
		List<com.rjgehan.notes.notify.NtfyClient.Message> sent = new CopyOnWriteArrayList<>();
		List<String> topics = new CopyOnWriteArrayList<>();
		com.rjgehan.notes.notify.NtfyConfig config = new com.rjgehan.notes.notify.NtfyConfig(
				java.net.URI.create("https://ntfy.sh"), "default", null,
				new com.rjgehan.notes.notify.NtfyConfig.Alerts(true, "default"), "remind");
		NtfyRoute route = new NtfyRoute(() -> new com.rjgehan.notes.notify.NtfyConfigFile.Loaded(config, null),
				(c, topic, message) -> {
					topics.add(topic);
					sent.add(message);
				}, "https://notes.example.ts.net");
		ReminderMessage message = new ReminderMessage("task:t1:2026-10-16T12:05", "task", "t1", "2026-10-16T12:05",
				"Pay rent", "Due 2026-10-16\nIBAN in the notes", "/x/tasks/today?task=t1");
		assertThat(route.deliver(message, RemindersSettings.defaults()).accepted()).isTrue();
		assertThat(sent.get(0).title()).isEqualTo("Pay rent");
		assertThat(sent.get(0).body()).isEqualTo("Task reminder");
		assertThat(sent.get(0).click()).hasToString("https://notes.example.ts.net/x/tasks/today?task=t1");
		assertThat(topics).containsExactly("remind");

		RemindersSettings full = new RemindersSettings(false, true, false, false, false, "09:00");
		route.deliver(message, full);
		assertThat(sent.get(1).body()).isEqualTo("Due 2026-10-16\nIBAN in the notes");

		NtfyRoute missing = new NtfyRoute(() -> new com.rjgehan.notes.notify.NtfyConfigFile.Loaded(null, null),
				(c, topic, m) -> {
				}, null);
		assertThat(missing.deliver(message, full).error()).isEqualTo("ntfy.json is missing from the secrets directory");
	}

}

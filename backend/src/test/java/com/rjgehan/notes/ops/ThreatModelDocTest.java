package com.rjgehan.notes.ops;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * docs/SECURITY.md keeps up with the controls it describes: it once said that every login outside the allowlist gets
 * {@code 403}, and left family sharing's guest surface out of the threat model. The guest surface and its controls are
 * in it, every control it names for guests is a class that exists, and its table of checks to re-run names tests that
 * exist, the sharing ones included.
 */
class ThreatModelDocTest {

	private static final Path ROOT = Path.of("..");

	private static final List<String> GUEST_CONTROLS = List.of("HostAndIdentityFilter", "IdentityResolver", "ShareAccess",
			"ShareScope", "ShareRateLimiter", "GuestEventFilter");

	@Test
	void theGuestSurfaceAndItsControlsAreInTheThreatModel() throws Exception {
		String doc = read("docs/SECURITY.md");
		assertThat(doc).contains("### 3.12 Sharing with family (guests)").contains("`/api/s/**`").contains("`/s/**`");
		Set<String> mainClasses = javaNames("backend/src/main/java");
		for (String control : GUEST_CONTROLS) {
			assertThat(doc).as(control).contains("`" + control + "`");
			assertThat(mainClasses).as(control).contains(control);
		}
		// Owners and guests, not "admitted or refused".
		assertThat(doc).doesNotContain("Every admitted identity has full").doesNotContain("an admitted identity can use every vault");
		assertThat(section(doc, "### 5.2 ")).doesNotContain("a login outside the list → `403`;");
	}

	@Test
	void everyCheckToReRunNamesATestThatExists() throws Exception {
		String table = section(read("docs/SECURITY.md"), "## 8. ");
		Set<String> javaTests = javaNames("backend/src/test/java");
		List<String> named = new ArrayList<>();
		Matcher m = Pattern.compile("`([A-Z][A-Za-z0-9]*Test)`").matcher(table);
		while (m.find()) {
			named.add(m.group(1));
		}
		assertThat(named).contains("ShareAuthorizationIntegrationTest", "ShareIntegrationTest", "ShareScopeTest",
				"ShareRateLimiterTest");
		assertThat(javaTests).containsAll(named);
		Matcher f = Pattern.compile("`([a-zA-Z/]+\\.test\\.tsx?)`").matcher(table);
		int frontend = 0;
		while (f.find()) {
			frontend++;
			assertThat(ROOT.resolve("frontend/src").resolve(f.group(1))).as(f.group(1)).exists();
		}
		assertThat(frontend).isPositive();
	}

	/** From the heading that starts with {@code heading} to the next heading of the same or a higher level. */
	private static String section(String doc, String heading) {
		int start = doc.indexOf("\n" + heading);
		assertThat(start).as(heading).isNotNegative();
		String level = heading.substring(0, heading.indexOf(' ') + 1);
		int end = doc.length();
		for (String stop : List.of("\n# ", "\n## ", "\n### ")) {
			if (stop.length() - 1 > level.length()) {
				continue;
			}
			int next = doc.indexOf(stop, start + 1);
			if (next >= 0 && next < end) {
				end = next;
			}
		}
		return doc.substring(start, end);
	}

	private static Set<String> javaNames(String folder) throws IOException {
		try (Stream<Path> files = Files.walk(ROOT.resolve(folder))) {
			return files.map((p) -> p.getFileName().toString())
				.filter((name) -> name.endsWith(".java"))
				.map((name) -> name.substring(0, name.length() - ".java".length()))
				.collect(Collectors.toSet());
		}
	}

	private static String read(String path) throws IOException {
		return Files.readString(ROOT.resolve(path)).replace("\r\n", "\n");
	}

}

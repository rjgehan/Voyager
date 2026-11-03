package com.rjgehan.notes.ops;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.snakeyaml.engine.v2.api.Load;
import org.snakeyaml.engine.v2.api.LoadSettings;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The GitHub workflows (DESIGN §7.5, docs/DEVELOPMENT.md "How a change reaches the server"). A wrong condition or
 * path list in them shows only after {@code main} has moved, so the checks that matter are pinned here.
 */
class WorkflowsTest {

	private static final Path ROOT = Path.of("..");

	@Test
	void theDockerImageIsBuiltBeforeMainMoves() throws Exception {
		String condition = (String) job("ci.yml", "docker-build").get("if");
		// The integrator checks build/next with "Run workflow" before the lead fast-forwards main.
		assertThat(runs(condition, "workflow_dispatch", "refs/heads/build/next")).as(condition).isTrue();
		assertThat(runs(condition, "pull_request", "refs/pull/12/merge")).as(condition).isTrue();
		// On main, publish.yml builds the image itself.
		assertThat(runs(condition, "push", "refs/heads/main")).as(condition).isFalse();
		assertThat(runs(condition, "schedule", "refs/heads/main")).as(condition).isFalse();
	}

	/**
	 * Whether a job's {@code if:} lets it run for an event on a ref. Only what the workflows use is understood:
	 * {@code ||}, {@code &&} and {@code ==} / {@code !=} between {@code github.event_name} or {@code github.ref} and a
	 * string; anything else fails the test, so it is extended rather than misread.
	 */
	static boolean runs(String condition, String event, String ref) {
		if (condition == null) return true;
		String expression = condition.strip();
		if (expression.startsWith("${{") && expression.endsWith("}}")) {
			expression = expression.substring(3, expression.length() - 2).strip();
		}
		for (String any : expression.split("\\|\\|")) {
			boolean all = true;
			for (String term : any.split("&&")) all &= compare(term.strip(), event, ref);
			if (all) return true;
		}
		return false;
	}

	private static boolean compare(String term, String event, String ref) {
		Matcher m = Pattern.compile("(github\\.event_name|github\\.ref)\\s*(==|!=)\\s*'([^']*)'").matcher(term);
		if (!m.matches()) throw new IllegalArgumentException("Not understood by this test: " + term);
		String actual = m.group(1).equals("github.ref") ? ref : event;
		return m.group(2).equals("==") == actual.equalsIgnoreCase(m.group(3));
	}

	static Map<String, Object> workflow(String name) throws Exception {
		String text = Files.readString(ROOT.resolve(".github/workflows").resolve(name));
		return map(new Load(LoadSettings.builder().build()).loadFromString(text));
	}

	static Map<String, Object> job(String workflow, String name) throws Exception {
		return map(map(workflow(workflow).get("jobs")).get(name));
	}

	@SuppressWarnings("unchecked")
	static Map<String, Object> map(Object value) {
		assertThat(value).isInstanceOf(Map.class);
		return (Map<String, Object>) value;
	}

	@SuppressWarnings("unchecked")
	static List<Object> list(Object value) {
		assertThat(value).isInstanceOf(List.class);
		return (List<Object>) value;
	}

}

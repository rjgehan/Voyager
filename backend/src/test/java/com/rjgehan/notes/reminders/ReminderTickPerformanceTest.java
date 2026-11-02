package com.rjgehan.notes.reminders;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.rjgehan.notes.support.Api;
import com.rjgehan.notes.support.RunningApp;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The reminders scheduler's tick on a 500-task list (docs/PERFORMANCE.md): every 15 seconds it reads every task with a
 * reminder and decides what is due, so it must stay cheap. Asserted with the 3× margin of the other performance tests.
 * Excluded from the default build; run it with {@code ./mvnw test -Dtest=ReminderTickPerformanceTest -DexcludedGroups=}.
 */
@Tag("perf")
class ReminderTickPerformanceTest {

	private static final int TASKS = 500;

	@TempDir
	Path vault;

	/** 500 tasks, every fifth with a reminder around now (a day back to three days ahead), in one list. */
	private void writeTasks() throws IOException {
		DateTimeFormatter at = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");
		LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
		StringBuilder tasks = new StringBuilder();
		for (int i = 0; i < TASKS; i++) {
			if (i > 0) {
				tasks.append(",\n");
			}
			tasks.append("{ \"id\": \"t").append(String.format("%04d", i)).append("\", \"title\": \"Task ").append(i)
				.append("\", \"status\": \"open\", \"priority\": 0");
			if (i % 5 == 0) {
				tasks.append(", \"reminders\": [ { \"at\": \"").append(now.plusHours(i % 96 - 24).format(at)).append("\" } ]");
			}
			tasks.append(", \"tags\": [], \"links\": [], \"order\": \"a").append(i % 10).append("\" }");
		}
		Files.createDirectories(this.vault.resolve("Tasks"));
		Files.writeString(this.vault.resolve("Tasks/Big List.tasks"), "{ \"type\": \"notesapp-tasks\", \"version\": 1, "
				+ "\"list\": { \"id\": \"big\", \"name\": \"Big List\", \"order\": \"a0\", \"archived\": false, "
				+ "\"sections\": [] }, \"tasks\": [\n" + tasks + "\n] }\n", StandardCharsets.UTF_8);
	}

	@Test
	void aTickOverFiveHundredTasksIsCheap() throws IOException {
		writeTasks();
		try (RunningApp app = RunningApp.start(this.vault, Map.of("notes.welcome-note", "false",
				"notes.reminders.tick", "1h"))) {
			Api api = app.api();
			// The in-app route on, so the tick reads the tasks and delivers what is due.
			JsonNode current = api.get("/api/settings").ok(200);
			ObjectNode settings = (ObjectNode) current.get("settings");
			((ObjectNode) settings.get("reminders")).put("inApp", true);
			api.putJson("/api/settings", Map.of("settings", settings, "baseVersion", current.get("version").asString()))
				.ok(200);
			ReminderScheduler scheduler = app.bean(ReminderScheduler.class);
			for (int i = 0; i < 20; i++) {
				scheduler.tick();
			}
			List<Long> samples = new ArrayList<>();
			for (int i = 0; i < 50; i++) {
				long start = System.nanoTime();
				scheduler.tick();
				samples.add(System.nanoTime() - start);
			}
			long medianMicros = TimeUnit.NANOSECONDS.toMicros(samples.stream().sorted().toList().get(samples.size() / 2));
			System.out.printf("PERF %-45s %6d µs (target 5000, limit 15000)%n", "reminders tick, 500 tasks (median)",
					medianMicros);
			assertThat(medianMicros).isLessThanOrEqualTo(15_000);
			assertThat(scheduler.upcoming(5)).isNotEmpty();
		}
	}

}

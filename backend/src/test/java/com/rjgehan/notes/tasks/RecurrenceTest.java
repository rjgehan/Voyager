package com.rjgehan.notes.tasks;

import java.time.Duration;
import java.time.LocalDate;

import com.rjgehan.notes.api.dto.RecurrenceFrom;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

/** Recurrence rules and the roll-forward dates (2026-10-14 is a Wednesday). */
class RecurrenceTest {

	private static final LocalDate WEDNESDAY = LocalDate.of(2026, 10, 14);

	@Test
	void rulesAreNormalized() {
		assertThat(Recurrence.normalize("RRULE:freq=weekly;byday=mo,we")).isEqualTo("FREQ=WEEKLY;BYDAY=MO,WE");
		assertThat(Recurrence.normalize(" FREQ=MONTHLY;BYMONTHDAY=1; ")).isEqualTo("FREQ=MONTHLY;BYMONTHDAY=1");
		assertThat(Recurrence.normalize("FREQ=DAILY;INTERVAL=3;COUNT=5")).isEqualTo("FREQ=DAILY;INTERVAL=3;COUNT=5");
		assertThat(Recurrence.normalize("FREQ=YEARLY;UNTIL=20301231")).isEqualTo("FREQ=YEARLY;UNTIL=20301231");
	}

	@ParameterizedTest
	@ValueSource(strings = { "", "FREQ=HOURLY", "BYDAY=MO", "FREQ=WEEKLY;FOO=1", "FREQ=DAILY;FREQ=WEEKLY",
			"FREQ=DAILY;COUNT=2;UNTIL=20300101", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;UNTIL=tomorrow",
			"FREQ=WEEKLY;BYDAY=XX", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "FREQ=DAILY\nFREQ=WEEKLY",
			"FREQ=DAILY;BYSECOND=1", "DTSTART:20260101", "FREQ=DAILY;INTERVAL" })
	void unsupportedRulesAreRejected(String rule) {
		assertThatThrownBy(() -> Recurrence.normalize(rule)).isInstanceOf(IllegalArgumentException.class);
	}

	@Test
	void fromDueCountsFromTheDueDate() {
		// Completed early (on Monday) for Wednesday: the next Wednesday.
		assertThat(next("FREQ=WEEKLY", RecurrenceFrom.DUE, "2026-10-14", LocalDate.of(2026, 10, 12)))
			.isEqualTo("2026-10-21");
		// Completed on time.
		assertThat(next("FREQ=WEEKLY", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY)).isEqualTo("2026-10-21");
		assertThat(next("FREQ=MONTHLY", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY)).isEqualTo("2026-11-14");
		assertThat(next("FREQ=WEEKLY;BYDAY=MO,FR", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY))
			.isEqualTo("2026-10-16");
	}

	@Test
	void anOverdueTaskSkipsTheOccurrencesAlreadyPast() {
		// Due three weeks ago on a Wednesday, completed on Thursday 2026-11-05: next Wednesday after that.
		assertThat(next("FREQ=WEEKLY", RecurrenceFrom.DUE, "2026-10-14", LocalDate.of(2026, 11, 5)))
			.isEqualTo("2026-11-11");
		// A daily task years overdue rolls to tomorrow, fast.
		assertThat(next("FREQ=DAILY", RecurrenceFrom.DUE, "2020-01-01", WEDNESDAY)).isEqualTo("2026-10-15");
	}

	@Test
	void fromCompletionCountsFromTheCompletionDay() {
		assertThat(next("FREQ=DAILY;INTERVAL=3", RecurrenceFrom.COMPLETION, "2026-10-01", WEDNESDAY))
			.isEqualTo("2026-10-17");
		assertThat(next("FREQ=WEEKLY", RecurrenceFrom.COMPLETION, null, WEDNESDAY)).isEqualTo("2026-10-21");
		assertThat(next("FREQ=MONTHLY;BYMONTHDAY=1", RecurrenceFrom.COMPLETION, null, WEDNESDAY))
			.isEqualTo("2026-11-01");
	}

	@Test
	void aRuleOnSetDaysTickedEarlyFromCompletionMovesPastTheOccurrenceBeingCompleted() {
		// Watered on Tuesday 2026-11-03, due Wednesday 2026-11-04, weekly on Wednesday from completion: the next one,
		// never the occurrence just done (nor an earlier one).
		LocalDate tuesday = LocalDate.of(2026, 11, 3);
		RecurrenceFrom completion = RecurrenceFrom.COMPLETION;
		assertThat(next("FREQ=WEEKLY;BYDAY=WE", completion, "2026-11-04", tuesday)).isEqualTo("2026-11-11");
		assertThat(next("FREQ=WEEKLY;BYDAY=WE", completion, "2026-11-04T09:00", tuesday))
			.isEqualTo("2026-11-11T09:00");
		assertThat(next("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", completion, "2026-11-04", tuesday)).isEqualTo("2026-11-18");
		assertThat(next("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", completion, "2026-11-04", tuesday))
			.isEqualTo("2026-11-05");
		assertThat(next("FREQ=WEEKLY;BYDAY=WE", completion, "2026-11-11", tuesday)).isEqualTo("2026-11-18");
		assertThat(next("FREQ=WEEKLY;BYDAY=MO", completion, "2046-11-05", tuesday)).isEqualTo("2046-11-12");
		assertThat(next("FREQ=MONTHLY;BYMONTHDAY=15", completion, "2026-11-15", LocalDate.of(2026, 11, 14)))
			.isEqualTo("2026-12-15");
		assertThat(next("FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=15", completion, "2026-11-15", LocalDate.of(2026, 11, 14)))
			.isEqualTo("2027-11-15");
		Recurrence.Next counted = Recurrence.next("FREQ=WEEKLY;BYDAY=WE;COUNT=3", completion, "2026-11-04", tuesday);
		assertThat(counted).isNotNull();
		assertThat(counted.value()).isEqualTo("2026-11-11");
		assertThat(counted.rrule()).isEqualTo("FREQ=WEEKLY;BYDAY=WE;COUNT=2");
		// Ticked late, or without a date: the first set day after the completion day, as before.
		assertThat(next("FREQ=WEEKLY;BYDAY=WE", completion, "2026-11-04", LocalDate.of(2026, 11, 6)))
			.isEqualTo("2026-11-11");
		assertThat(next("FREQ=WEEKLY;BYDAY=WE", completion, null, tuesday)).isEqualTo("2026-11-04");
		// A plain interval counts from the completion day only: three days after Sunday is the due Wednesday.
		assertThat(next("FREQ=DAILY;INTERVAL=3", completion, "2026-11-04", LocalDate.of(2026, 11, 1)))
			.isEqualTo("2026-11-04");
		assertThat(next("FREQ=DAILY", completion, "2026-11-04", tuesday)).isEqualTo("2026-11-04");
	}

	@Test
	void timesAreKept() {
		assertThat(next("FREQ=DAILY", RecurrenceFrom.DUE, "2026-10-14T09:30", WEDNESDAY))
			.isEqualTo("2026-10-15T09:30");
		assertThat(next("FREQ=WEEKLY", RecurrenceFrom.COMPLETION, "2026-10-01T18:00", WEDNESDAY))
			.isEqualTo("2026-10-21T18:00");
		assertThat(next("FREQ=DAILY;BYHOUR=7;BYMINUTE=15", RecurrenceFrom.DUE, "2026-10-14T07:15", WEDNESDAY))
			.isEqualTo("2026-10-15T07:15");
		// An hour on an all-day task is ignored.
		assertThat(next("FREQ=DAILY;BYHOUR=7", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY)).isEqualTo("2026-10-15");
	}

	@Test
	void theMonthEndFollowsTheRule() {
		// RFC 5545: a month without a 31st has no occurrence.
		assertThat(next("FREQ=MONTHLY", RecurrenceFrom.DUE, "2026-01-31", LocalDate.of(2026, 1, 31)))
			.isEqualTo("2026-03-31");
		assertThat(next("FREQ=MONTHLY;BYMONTHDAY=-1", RecurrenceFrom.DUE, "2026-01-31", LocalDate.of(2026, 1, 31)))
			.isEqualTo("2026-02-28");
	}

	@Test
	void fromCompletionAMonthOrAYearLaterEndsOnTheLastDayOfAShorterMonth() {
		// "Pay the card every month when done": a month after the completion day, never two.
		RecurrenceFrom completion = RecurrenceFrom.COMPLETION;
		assertThat(next("FREQ=MONTHLY", completion, null, LocalDate.of(2026, 1, 30))).isEqualTo("2026-02-28");
		assertThat(next("FREQ=MONTHLY", completion, null, LocalDate.of(2026, 1, 29))).isEqualTo("2026-02-28");
		assertThat(next("FREQ=MONTHLY", completion, "2026-01-30", LocalDate.of(2026, 1, 30))).isEqualTo("2026-02-28");
		assertThat(next("FREQ=MONTHLY", completion, null, LocalDate.of(2026, 3, 31))).isEqualTo("2026-04-30");
		assertThat(next("FREQ=MONTHLY;INTERVAL=3", completion, null, LocalDate.of(2026, 11, 30)))
			.isEqualTo("2027-02-28");
		assertThat(next("FREQ=MONTHLY", completion, "2026-01-05T09:00", LocalDate.of(2026, 1, 31)))
			.isEqualTo("2026-02-28T09:00");
		assertThat(next("FREQ=YEARLY", completion, null, LocalDate.of(2028, 2, 29))).isEqualTo("2029-02-28");
		// Without a date, "from due" counts from the completion day too.
		assertThat(next("FREQ=MONTHLY", RecurrenceFrom.DUE, null, LocalDate.of(2026, 1, 30))).isEqualTo("2026-02-28");
		// A day that every month has is kept, and COUNT and UNTIL still apply.
		assertThat(next("FREQ=MONTHLY", completion, null, LocalDate.of(2026, 1, 15))).isEqualTo("2026-02-15");
		Recurrence.Next counted = Recurrence.next("FREQ=MONTHLY;COUNT=3", completion, null, LocalDate.of(2026, 1, 30));
		assertThat(counted).isNotNull();
		assertThat(counted.value()).isEqualTo("2026-02-28");
		assertThat(counted.rrule()).isEqualTo("FREQ=MONTHLY;COUNT=2");
		assertThat(Recurrence.next("FREQ=MONTHLY;UNTIL=20260227", completion, null, LocalDate.of(2026, 1, 30)))
			.isNull();
		assertThat(next("FREQ=MONTHLY;UNTIL=20260228", completion, null, LocalDate.of(2026, 1, 30)))
			.isEqualTo("2026-02-28");
		// A rule that names its days is left to them.
		assertThat(next("FREQ=MONTHLY;BYMONTHDAY=31", completion, null, LocalDate.of(2026, 1, 31)))
			.isEqualTo("2026-03-31");
		assertThat(next("FREQ=MONTHLY;BYMONTH=1,4,7,10", completion, null, LocalDate.of(2026, 1, 15)))
			.isEqualTo("2026-04-15");
	}

	@Test
	void countIsTheNumberOfOccurrencesLeft() {
		Recurrence.Next next = Recurrence.next("FREQ=DAILY;COUNT=3", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY);
		assertThat(next).isNotNull();
		assertThat(next.value()).isEqualTo("2026-10-15");
		assertThat(next.rrule()).isEqualTo("FREQ=DAILY;COUNT=2");
		next = Recurrence.next(next.rrule(), RecurrenceFrom.DUE, next.value(), LocalDate.of(2026, 10, 15));
		assertThat(next.rrule()).isEqualTo("FREQ=DAILY;COUNT=1");
		assertThat(Recurrence.next(next.rrule(), RecurrenceFrom.DUE, next.value(), LocalDate.of(2026, 10, 16)))
			.isNull();
	}

	@Test
	void untilEndsTheSeries() {
		assertThat(next("FREQ=WEEKLY;UNTIL=20261025", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY))
			.isEqualTo("2026-10-21");
		assertThat(Recurrence.next("FREQ=WEEKLY;UNTIL=20261020", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY))
			.isNull();
		assertThat(Recurrence.next("FREQ=WEEKLY;UNTIL=20261028T235959Z", RecurrenceFrom.DUE, "2026-10-21",
				WEDNESDAY)).isNotNull();
	}

	@Test
	void aRuleThatCannotBeEvaluatedHasNoNextOccurrence() {
		assertThat(Recurrence.next("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", RecurrenceFrom.DUE, "2026-10-14",
				WEDNESDAY)).isNull();
		assertThat(Recurrence.next("NONSENSE", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY)).isNull();
	}

	@ParameterizedTest
	@ValueSource(strings = { "0", "-1", "-2", "abc", "1.5", "999999" })
	void aHandEditedIntervalThatIsNotAPositiveNumberNeverLoops(String interval) {
		// A .tasks file edited by hand can hold any INTERVAL (the API's normalize refuses them): completing such a
		// task must neither hang nor roll it forward by a made-up step, from the due date (which fast-forwards past
		// the missed occurrences) or from completion.
		assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
			for (String freq : new String[] { "DAILY", "WEEKLY", "MONTHLY", "YEARLY" }) {
				String rule = "FREQ=" + freq + ";INTERVAL=" + interval;
				assertThat(Recurrence.next(rule, RecurrenceFrom.DUE, "2020-01-01", WEDNESDAY)).as(rule).isNull();
				assertThat(Recurrence.next(rule, RecurrenceFrom.COMPLETION, "2026-10-14T09:00", WEDNESDAY)).as(rule)
					.isNull();
				assertThat(Recurrence.next(rule + ";COUNT=5", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY)).as(rule)
					.isNull();
			}
		});
	}

	@Test
	void aHandEditedCountThatIsNotAPositiveNumberIsNotRepeated() {
		for (String count : new String[] { "0", "-3", "abc", "999999" }) {
			assertThat(Recurrence.next("FREQ=DAILY;COUNT=" + count, RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY))
				.as(count)
				.isNull();
		}
		assertThat(Recurrence.next("FREQ=DAILY;COUNT=2", RecurrenceFrom.DUE, "2026-10-14", WEDNESDAY)).isNotNull();
	}

	@ParameterizedTest
	@ValueSource(strings = { "FREQ=DAILY;UNTIL=2026-11-03", "FREQ=DAILY;UNTIL=20261120Z", "FREQ=WEEKLY;BYDAY=TU,THU",
			"FREQ=WEEKLY;BYDAY=THU", "FREQ=MONTHLY;BYMONTHDAY=0", "FREQ=MONTHLY;BYMONTHDAY=32", "FREQ=YEARLY;BYMONTH=13",
			"FREQ=WEEKLY;WKST=XX", "FREQ=HOURLY", "FREQ=MINUTELY", "FREQ=SECONDLY", "INTERVAL=2", "BYDAY=MO",
			"FREQ=FORTNIGHTLY", "FREQ=DAILY;COUNT=3;UNTIL=20261120", "FREQ=MONTHLY;WKST=XX" })
	void aHandEditedRuleTheApiWouldRefuseIsReportedAndNeverEvaluated(String rule) {
		// A .tasks file edited by hand can hold any rule: what normalize refuses is reported as a problem, and
		// completing the task closes it rather than evaluating a guess (lib-recur's lax mode drops what it cannot
		// read: THU, an unreadable UNTIL that would mean "no end", a frequency of hours).
		assertThat(Recurrence.storedRuleProblem(rule)).as(rule).isNotNull();
		assertThatThrownBy(() -> Recurrence.normalize(rule)).isInstanceOf(IllegalArgumentException.class);
		LocalDate day = LocalDate.of(2026, 11, 5);
		for (RecurrenceFrom from : RecurrenceFrom.values()) {
			assertThat(Recurrence.next(rule, from, "2026-11-02", day)).as(rule + " " + from).isNull();
			assertThat(Recurrence.next(rule, from, "2026-11-02T09:00", day)).as(rule + " " + from).isNull();
			assertThat(Recurrence.next(rule, from, null, day)).as(rule + " " + from).isNull();
		}
	}

	@ParameterizedTest
	@ValueSource(strings = { "FREQ=WEEKLY;BYDAY=TU,TH", "FREQ=DAILY;UNTIL=20261120", "FREQ=DAILY;UNTIL=20261120T235959Z",
			"FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=31", "FREQ=WEEKLY;WKST=SU;BYDAY=MO",
			"FREQ=DAILY;BYHOUR=9;BYMINUTE=30", "FREQ=MONTHLY;BYDAY=-1FR", "FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2",
			"freq=weekly;byday=mo" })
	void aHandEditedRuleTheApiWouldStoreIsFine(String rule) {
		assertThat(Recurrence.storedRuleProblem(rule)).as(rule).isNull();
		assertThat(Recurrence.next(rule, RecurrenceFrom.DUE, "2026-11-02", LocalDate.of(2026, 11, 2))).as(rule)
			.isNotNull();
	}

	private static String next(String rule, RecurrenceFrom from, String anchor, LocalDate day) {
		Recurrence.Next next = Recurrence.next(rule, from, anchor, day);
		assertThat(next).as(rule).isNotNull();
		return next.value();
	}

}

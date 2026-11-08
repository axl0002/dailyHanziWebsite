import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdminOnlyPath } from "../lib/adminAccess.ts";
import {
  defaultRange,
  latestCutoff,
  periodStart,
  summarize,
  trendCsv,
  trendPoints,
  validateRange,
} from "../lib/northStar.ts";
import type { NorthStarMetricReport } from "../lib/northStarTypes.ts";

function report(
  overrides: Partial<NorthStarMetricReport> = {},
): NorthStarMetricReport {
  return {
    definition_version: "hanzi_nsm_v1",
    practice_basis: "append_only_server_capture_v1",
    params: {
      start_at: "2026-10-05T00:00:00Z",
      as_of: "2026-11-04T00:00:00Z",
      capture_start: "2026-10-05T00:00:00Z",
    },
    coverage: {},
    trial_activation_by_week: [],
    weekly_paid_learning_habit: [],
    monthly_trial_activation: [],
    monthly_paid_habit: [],
    paid_habit_by_tenure: [],
    trial_to_paid_diagnostic: [],
    renewal_diagnostic: [],
    ...overrides,
  };
}
const trial = (date: string, rate: number | null, store = "APP_STORE") => ({
  trial_week: date,
  store,
  trials: 100,
  activated: 40,
  activation_pct: rate,
  practiced_in_48h: 50,
  widget_observed_in_48h: 60,
  widget_known_before_trial: 0,
  successful_snapshot_in_48h: 70,
  fully_prospective: true,
});
const paid = (date: string, rate: number | null) => ({
  week_start: date,
  paying_at_start: 200,
  practicing_two_days: 20,
  habit_pct: rate,
  diagnostic_three_days: 10,
  fully_prospective: true,
  candidate_charge_accounts: 210,
});

test("new North Star path and descendants have the same admin-only classification as revenue dashboard", () => {
  for (const route of [
    "/admin/north-star",
    "/admin/north-star/export",
    "/admin/dashboard",
  ])
    assert.equal(isAdminOnlyPath(route), true);
  for (const route of [
    "/admin/analytics",
    "/admin/north-star-public",
    "/admin/login",
  ])
    assert.equal(isAdminOnlyPath(route), false);
});
test("arrival cutoff uses UTC midnight rather than browser timezone", () => {
  assert.equal(
    latestCutoff(new Date("2026-10-27T00:30:00+14:00")),
    "2026-10-24",
  );
  assert.equal(
    latestCutoff(new Date("2026-10-27T23:59:00-11:00")),
    "2026-10-26",
  );
});
test("range validation rejects malformed, reversed, premature and unbounded requests", () => {
  const cutoff = "2026-11-01";
  assert.equal(validateRange("2026-09-16", "2026-10-31", cutoff), null);
  for (const [start, end] of [
    ["2026-02-31", "2026-10-31"],
    ["2026-09-15", "2026-10-31"],
    ["2026-10-31", "2026-10-31"],
    ["2026-09-16", "2026-11-02"],
  ])
    assert.ok(validateRange(start, end, cutoff));
  assert.ok(validateRange("2026-09-16", "2028-10-31", "2028-11-01"));
});
test("week and month boundaries are UTC, including Sunday and year rollover", () => {
  assert.equal(
    periodStart("2027-01-03T22:00:00Z", "week").toISOString(),
    "2026-12-28T00:00:00.000Z",
  );
  assert.equal(
    periodStart("2027-01-03T22:00:00Z", "month").toISOString(),
    "2027-01-01T00:00:00.000Z",
  );
});
test("trial store filter does not pool uncovered stores or average rates", () => {
  const rows = trendPoints(
    report({
      trial_activation_by_week: [
        trial("2026-10-05", 40),
        trial("2026-10-05", null, "PLAY_STORE"),
      ],
    }),
    "activation",
    "week",
    "APP_STORE",
  );
  assert.equal(rows[0].rate, 40);
  assert.equal(rows[0].denominator, 100);
  assert.equal(rows[0].status, "complete");
});
test("missing periods remain null gaps rather than zero or a line joining distant cohorts", () => {
  const points = trendPoints(
    report({
      trial_activation_by_week: [
        trial("2026-10-05", 40),
        trial("2026-10-19", 50),
      ],
    }),
    "activation",
    "week",
    "APP_STORE",
  );
  assert.equal(points[1].date, "2026-10-12");
  assert.equal(points[1].rate, null);
  assert.equal(points[1].status, "empty");
});
test("a genuine measured 0% remains zero; uncovered widget data remains unknown", () => {
  const points = trendPoints(
    report({
      trial_activation_by_week: [
        trial("2026-10-05", 0),
        trial("2026-10-12", null),
      ],
    }),
    "activation",
    "week",
    "APP_STORE",
  );
  assert.equal(points[0].rate, 0);
  assert.equal(points[0].status, "complete");
  assert.equal(points[1].rate, null);
  assert.equal(points[1].status, "unknown");
});
test("fully_prospective provenance does not make a partial trial week complete", () => {
  const points = trendPoints(
    report({
      params: {
        start_at: "2026-10-07T05:51:00Z",
        as_of: "2026-10-14T00:00:00Z",
        capture_start: "2026-10-07T05:51:00Z",
      },
      trial_activation_by_week: [
        trial("2026-10-05", 40),
        trial("2026-10-12", 50),
      ],
    }),
    "activation",
    "week",
    "APP_STORE",
  );
  assert.equal(points[0].status, "partial");
  assert.equal(points[1].status, "partial");
});
test("trial weeks need two extra days after the last trial start for full-period comparison", () => {
  const r = report({
    params: {
      start_at: "2026-10-05T00:00:00Z",
      as_of: "2026-10-13T00:00:00Z",
      capture_start: "2026-10-05T00:00:00Z",
    },
    trial_activation_by_week: [trial("2026-10-05", 40)],
  });
  assert.equal(
    trendPoints(r, "activation", "week", "APP_STORE")[0].status,
    "partial",
  );
});
test("paid denominator is retained exactly as supplied by paid-at-week-start SQL", () => {
  const points = trendPoints(
    report({ weekly_paid_learning_habit: [paid("2026-10-05", 10)] }),
    "habit",
    "week",
    "APP_STORE",
  );
  assert.equal(points[0].denominator, 200);
  assert.equal(points[0].numerator, 20);
  assert.equal(points[0].rate, 10);
});
test("monthly paid rates use the server pooled learner-week ratio, not weekly percentage averages", () => {
  const points = trendPoints(
    report({
      monthly_paid_habit: [
        {
          month_start: "2026-10-01",
          paid_learner_weeks: 300,
          habit_learner_weeks: 40,
          habit_pct: 13.33,
          full_month_of_week_starts: false,
        },
      ],
    }),
    "habit",
    "month",
    "APP_STORE",
  );
  assert.equal(points[0].rate, 13.33);
  assert.equal(points[0].denominator, 300);
  assert.equal(points[0].status, "partial");
});
test("headline and delta compare complete periods and skip partial trailing periods", () => {
  const points = trendPoints(
    report({
      weekly_paid_learning_habit: [
        paid("2026-10-05", 10),
        paid("2026-10-12", 12),
        paid("2026-11-02", 90),
      ],
    }),
    "habit",
    "week",
    "APP_STORE",
  );
  const result = summarize(points);
  assert.equal(result.current?.date, "2026-10-12");
  assert.equal(result.change, 2);
});
test("first partial cohort can display a rate without an invalid complete-period delta", () => {
  const points = trendPoints(
    report({ trial_activation_by_week: [trial("2026-11-02", 40)] }),
    "activation",
    "week",
    "APP_STORE",
  );
  assert.equal(summarize(points).current?.status, "partial");
  assert.equal(summarize(points).change, null);
});
test("no prospective report yields pending display with no fabricated 0%", () => {
  assert.deepEqual(trendPoints(null, "activation", "week", "APP_STORE"), []);
  assert.deepEqual(summarize([]), { current: null, change: null });
});
test("CSV keeps counts, source, status and blank unknown rates", () => {
  const csv = trendCsv(
    [
      {
        date: "2026-10-05",
        numerator: 0,
        denominator: 100,
        rate: null,
        status: "unknown",
      },
    ],
    "activation",
    "week",
    "historical",
    "APP_STORE",
  );
  assert.ok(
    csv.includes(
      "activation,historical,APP_STORE,week,2026-10-05,0,100,,unknown",
    ),
  );
  assert.ok(!csv.includes("NaN"));
});

test("default dashboard window rolls forward within the server bound as tracking ages", () => {
  assert.deepEqual(defaultRange(new Date("2026-10-27T12:00:00Z")), {
    start: "2026-09-16",
    end: "2026-10-25",
  });
  const range = defaultRange(new Date("2028-10-27T12:00:00Z"));
  assert.equal(validateRange(range.start, range.end, "2028-10-25"), null);
  assert.equal(
    (Date.parse(range.end) - Date.parse(range.start)) / 86400000,
    365,
  );
});

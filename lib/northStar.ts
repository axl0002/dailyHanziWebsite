import type { NorthStarMetricReport } from "./northStarTypes";

export type Interval = "week" | "month";
export type Metric = "activation" | "habit";
export type TrendPoint = {
  date: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  status: "complete" | "partial" | "pending" | "unknown" | "empty";
};

export const FIRST_TRACKED_DATE = "2026-09-16";
const DAY = 86_400_000;

export function latestCutoff(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      2 * DAY,
  )
    .toISOString()
    .slice(0, 10);
}

export function defaultRange(now = new Date()): { start: string; end: string } {
  const end = latestCutoff(now);
  const rollingStart = new Date(Date.parse(end) - 365 * DAY)
    .toISOString()
    .slice(0, 10);
  return {
    start:
      rollingStart > FIRST_TRACKED_DATE ? rollingStart : FIRST_TRACKED_DATE,
    end,
  };
}

export function validateRange(
  start: string,
  end: string,
  maxEnd = latestCutoff(),
): string | null {
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end)) return "Choose a valid start and end date.";
  if (start < FIRST_TRACKED_DATE)
    return "Available history starts September 16, 2026.";
  if (end <= start) return "End date must be after the start date.";
  if (end > maxEnd)
    return "The latest two days are held back to allow events to arrive.";
  if (Date.parse(end) - Date.parse(start) > 400 * DAY)
    return "Choose a range of 400 days or fewer.";
  return null;
}

export function periodStart(value: string, interval: Interval): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  if (interval === "month") date.setUTCDate(1);
  else date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

function nextPeriod(date: Date, interval: Interval): Date {
  const next = new Date(date);
  if (interval === "week") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** Preserve server rates/null coverage and counts; never average percentages. */
export function trendPoints(
  report: NorthStarMetricReport | null,
  metric: Metric,
  interval: Interval,
  store: string,
): TrendPoint[] {
  if (!report) return [];
  const rows: Array<{
    date: string;
    numerator: number;
    denominator: number;
    rate: number | null;
    full?: boolean;
  }> =
    metric === "activation"
      ? interval === "week"
        ? report.trial_activation_by_week
            .filter((r) => (r.store ?? "UNKNOWN") === store)
            .map((r) => ({
              date: r.trial_week,
              numerator: r.activated,
              denominator: r.trials,
              rate: r.activation_pct,
            }))
        : report.monthly_trial_activation
            .filter((r) => (r.store ?? "UNKNOWN") === store)
            .map((r) => ({
              date: r.month_start,
              numerator: r.activated,
              denominator: r.trials,
              rate: r.activation_pct,
              full: r.full_month,
            }))
      : interval === "week"
        ? report.weekly_paid_learning_habit.map((r) => ({
            date: r.week_start,
            numerator: r.practicing_two_days,
            denominator: r.paying_at_start,
            rate: r.habit_pct,
          }))
        : report.monthly_paid_habit.map((r) => ({
            date: r.month_start,
            numerator: r.habit_learner_weeks,
            denominator: r.paid_learner_weeks,
            rate: r.habit_pct,
            full: r.full_month_of_week_starts,
          }));
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const result: TrendPoint[] = [];
  const start = Date.parse(report.params.start_at);
  const end = Date.parse(report.params.as_of);
  // Keep missing periods as gaps instead of connecting nonadjacent cohorts.
  for (
    let date = periodStart(report.params.start_at, interval);
    date.getTime() < end;
    date = nextPeriod(date, interval)
  ) {
    const key = date.toISOString().slice(0, 10);
    const row = byDate.get(key);
    const periodEnd = nextPeriod(date, interval).getTime();
    const lag =
      metric === "activation" ? 2 * DAY : interval === "month" ? 7 * DAY : 0;
    const complete =
      row?.full ?? (date.getTime() >= start && periodEnd + lag <= end);
    const numerator = row?.numerator ?? 0;
    const denominator = row?.denominator ?? 0;
    const rate = row?.rate ?? null;
    const status: TrendPoint["status"] =
      denominator === 0
        ? complete
          ? "empty"
          : "pending"
        : rate === null
          ? "unknown"
          : complete
            ? "complete"
            : "partial";
    result.push({ date: key, numerator, denominator, rate, status });
  }
  return result;
}

export function summarize(points: TrendPoint[]) {
  const complete = points.filter(
    (p) => p.status === "complete" && p.rate !== null,
  );
  const current =
    complete.at(-1) ?? points.findLast((p) => p.rate !== null) ?? null;
  const previous = current?.status === "complete" ? complete.at(-2) : null;
  return {
    current,
    change:
      current?.rate != null && previous?.rate != null
        ? Math.round((current.rate - previous.rate) * 100) / 100
        : null,
  };
}

export function formatPeriod(date: string, interval: Interval): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    ...(interval === "week" ? { day: "numeric" } : {}),
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}

export const STATUS_LABELS = {
  complete: "Complete",
  partial: "Partial period",
  pending: "Pending",
  unknown: "Unknown coverage",
  empty: "No eligible cohort",
};

export function trendCsv(
  points: TrendPoint[],
  metric: Metric,
  interval: Interval,
  source: string,
  store: string,
): string {
  const header =
    "metric,source,store,interval,period_start_utc,numerator,denominator,rate_percent,status";
  return (
    [
      header,
      ...points.map((p) =>
        [
          metric,
          source,
          metric === "activation" ? store : "ALL",
          interval,
          p.date,
          p.numerator,
          p.denominator,
          p.rate ?? "",
          p.status,
        ].join(","),
      ),
    ].join("\n") + "\n"
  );
}

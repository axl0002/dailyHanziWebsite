"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import type {
  NorthStarDashboard,
  NorthStarMetricReport,
} from "@/lib/northStarTypes";
import {
  FIRST_TRACKED_DATE,
  STATUS_LABELS,
  defaultRange,
  formatPeriod,
  latestCutoff,
  summarize,
  trendCsv,
  trendPoints,
  validateRange,
} from "@/lib/northStar";
import type { Interval, Metric, TrendPoint } from "@/lib/northStar";

const CARD = "rounded-xl border border-gray-200 bg-white p-6 shadow-sm";
const BUTTON =
  "rounded-md px-3 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-50";
const DATE =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800";
const number = (n: number) => n.toLocaleString("en-GB");
const instant = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
const storeName = (value: string) =>
  ({
    APP_STORE: "App Store",
    PLAY_STORE: "Google Play",
    STRIPE: "Stripe",
    UNKNOWN: "Unknown store",
  })[value] ?? value;

function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`${BUTTON} ${value === option.value ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function exportCsv(
  points: TrendPoint[],
  metric: Metric,
  interval: Interval,
  source: string,
  store: string,
) {
  const blob = new Blob([trendCsv(points, metric, interval, source, store)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `north-star-${metric}-${source}-${interval}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MetricCard({
  title,
  description,
  metric,
  report,
  interval,
  source,
  store,
}: {
  title: string;
  description: string;
  metric: Metric;
  report: NorthStarMetricReport | null;
  interval: Interval;
  source: string;
  store: string;
}) {
  const points = trendPoints(report, metric, interval, store);
  const { current, change } = summarize(points);
  const hasValues = points.some((point) => point.rate !== null);
  const unit =
    metric === "habit" && interval === "month"
      ? "paying learner-weeks"
      : metric === "habit"
        ? "paying subscribers"
        : "new trial users";
  const colour = source === "historical" ? "#d97706" : "#6366f1";
  return (
    <section className={CARD} aria-label={title}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">{description}</p>
        </div>
        <button
          disabled={!points.length}
          onClick={() => exportCsv(points, metric, interval, source, store)}
          className="shrink-0 rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>
      <div className="mb-6 mt-6 flex flex-wrap items-end gap-x-5 gap-y-2">
        <p className="text-4xl font-bold tracking-tight text-gray-900">
          {current?.rate != null ? current.rate.toFixed(1) + "%" : "—"}
        </p>
        <div className="text-sm text-gray-500">
          {current ? (
            <>
              <p>
                {number(current.numerator)} / {number(current.denominator)}{" "}
                {unit}
              </p>
              <p className="mt-0.5 text-xs">
                {current.status === "complete"
                  ? `Latest complete ${interval}`
                  : "Partial period"}{" "}
                · {formatPeriod(current.date, interval)}
              </p>
            </>
          ) : (
            <p>No mature measured cohort yet</p>
          )}
        </div>
        {change !== null && (
          <p className="text-sm font-medium text-gray-600">
            {change > 0 ? "+" : ""}
            {change.toFixed(1)} pp{" "}
            <span className="font-normal text-gray-400">
              vs previous complete {interval}
            </span>
          </p>
        )}
      </div>
      {hasValues ? (
        <div
          className="h-64 w-full"
          aria-label={`${title} percentage over time`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 10, right: 12, left: 0, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#f0f0f0"
              />
              <XAxis
                dataKey="date"
                tickFormatter={(date) => formatPeriod(String(date), interval)}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={{ fontSize: 11, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as TrendPoint | undefined;
                  if (!active || !point) return null;
                  return (
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg">
                      <p className="font-semibold text-gray-900">
                        {formatPeriod(point.date, interval)}
                      </p>
                      <p className="mt-1 text-gray-700">
                        {point.rate?.toFixed(2) ?? "Unknown"}% ·{" "}
                        {number(point.numerator)} / {number(point.denominator)}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {STATUS_LABELS[point.status]}
                      </p>
                    </div>
                  );
                }}
              />
              <Line
                type="linear"
                dataKey="rate"
                name={title}
                stroke={colour}
                strokeWidth={2.5}
                dot={{ r: 4, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="flex h-56 items-center justify-center rounded-lg bg-gray-50 p-6 text-center">
          <div>
            <p className="font-medium text-gray-600">
              {points.some((p) => p.status === "unknown")
                ? "Widget coverage is unknown for this cohort"
                : "Waiting for a mature cohort"}
            </p>
            <p className="mt-2 max-w-md text-sm text-gray-500">
              {metric === "activation"
                ? "Trials need a complete 48-hour window plus the event-arrival buffer."
                : "Only complete Monday-to-Monday weeks count. Practice is measured on two distinct learner-local dates."}
            </p>
          </div>
        </div>
      )}
      {points.length > 0 && (
        <details className="mt-5 border-t border-gray-100 pt-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-600">
            View cohort counts and period status
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{title} cohort counts</caption>
              <thead className="text-gray-500">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    {interval === "week" ? "Week starting" : "Month"}
                  </th>
                  <th scope="col" className="pr-4">
                    Qualified
                  </th>
                  <th scope="col" className="pr-4">
                    Eligible
                  </th>
                  <th scope="col" className="pr-4">
                    Rate
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {points.map((point) => (
                  <tr key={point.date} className="text-gray-700">
                    <th
                      scope="row"
                      className="whitespace-nowrap py-2 pr-4 font-normal"
                    >
                      {formatPeriod(point.date, interval)}
                    </th>
                    <td className="pr-4">{number(point.numerator)}</td>
                    <td className="pr-4">{number(point.denominator)}</td>
                    <td className="pr-4">
                      {point.rate === null ? "—" : point.rate.toFixed(2) + "%"}
                    </td>
                    <td className="whitespace-nowrap">
                      {STATUS_LABELS[point.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="mt-4 text-xs leading-relaxed text-gray-400">
        {metric === "activation"
          ? "Store-specific trial cohorts. Missing widget evidence is not proof that a widget was never installed."
          : interval === "month"
            ? "Monthly rate pools qualifying learner-weeks / paying learner-weeks, rather than averaging weekly percentages."
            : "Paying at the start of the week is the denominator, including people whose subscription expires during that week."}{" "}
        Partial periods are labelled; missing periods remain gaps.
      </p>
    </section>
  );
}

export default function NorthStarPage() {
  const [source, setSource] = useState<"prospective" | "historical">(
    "prospective",
  );
  const [interval, setInterval] = useState<Interval>("week");
  const [store, setStore] = useState("APP_STORE");
  const [initialRange] = useState(() => defaultRange());
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [request, setRequest] = useState({
    ...initialRange,
    refresh: false,
    sequence: 0,
  });
  const [data, setData] = useState<NorthStarDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const { data: raw, error: rpcError } = await supabase
          .rpc("admin_north_star_report", {
            p_start: request.start,
            p_end: request.end,
            p_refresh: request.refresh,
          })
          .abortSignal(abort.signal);
        if (cancelled) return;
        if (rpcError)
          throw new Error(
            rpcError.code === "42501"
              ? "Admin access is required to view these metrics."
              : rpcError.code === "55P03"
                ? "A report refresh is already running. Try again shortly."
                : rpcError.code === "57014"
                  ? "The report timed out. Try a shorter date range."
                  : rpcError.message,
          );
        if (
          !raw ||
          raw.definition_version !== "hanzi_nsm_v1" ||
          !raw.historical_proxy ||
          !raw.capture_health ||
          !raw.cache
        )
          throw new Error(
            "The report returned an unexpected response. Please retry.",
          );
        setData(raw as NorthStarDashboard);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Unable to load the report.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [request]);

  const report =
    source === "prospective"
      ? (data?.prospective ?? null)
      : (data?.historical_proxy ?? null);
  const stores = [
    ...new Set([
      "APP_STORE",
      ...(report?.trial_activation_by_week.map(
        (row) => row.store ?? "UNKNOWN",
      ) ?? []),
    ]),
  ];
  const activeStore = stores.includes(store) ? store : "APP_STORE";
  const submit = (refresh: boolean) => {
    const validation = validateRange(start, end);
    setRangeError(validation);
    if (validation) return;
    setRequest((previous) => ({
      start,
      end,
      refresh,
      sequence: previous.sequence + 1,
    }));
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            North Star Metrics
          </h1>
          <p className="mt-1 text-gray-600">
            Are new users reaching value, and are paying learners building a
            habit?
          </p>
        </div>
        <button
          disabled={loading}
          onClick={() => submit(true)}
          className={`${BUTTON} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
        >
          {loading ? "Loading report…" : "Refresh data"}
        </button>
      </header>
      <div className={`${CARD} flex flex-wrap items-end justify-between gap-5`}>
        <div className="space-y-3">
          <Segment
            label="Measurement source"
            value={source}
            onChange={setSource}
            options={[
              { value: "prospective", label: "New tracking" },
              { value: "historical", label: "Historical estimate" },
            ]}
          />
          <Segment
            label="Time grouping"
            value={interval}
            onChange={setInterval}
            options={[
              { value: "week", label: "Weekly" },
              { value: "month", label: "Monthly" },
            ]}
          />
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit(false);
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col gap-1.5 text-xs font-medium text-gray-500">
            Start date (UTC)
            <input
              aria-label="Start date"
              type="date"
              min={FIRST_TRACKED_DATE}
              max={end}
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className={DATE}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-gray-500">
            End date, exclusive (UTC)
            <input
              aria-label="End date"
              type="date"
              min={start}
              max={latestCutoff()}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className={DATE}
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className={`${BUTTON} bg-indigo-600 text-white hover:bg-indigo-700`}
          >
            Apply dates
          </button>
        </form>
        {rangeError && (
          <p role="alert" className="w-full text-sm text-red-600">
            {rangeError}
          </p>
        )}
      </div>
      {loading ? (
        <div
          role="status"
          aria-label="Loading North Star metrics"
          className="grid gap-6 lg:grid-cols-2"
        >
          <p className="text-sm text-gray-500 lg:col-span-2">
            Calculating cohorts. The first request can take longer; later visits
            use cached results.
          </p>
          {[0, 1].map((key) => (
            <div key={key} className={`${CARD} h-96 motion-safe:animate-pulse`}>
              <div className="h-5 w-40 rounded bg-gray-100" />
              <div className="mt-4 h-3 w-64 max-w-full rounded bg-gray-100" />
              <div className="mt-8 h-10 w-24 rounded bg-gray-100" />
              <div className="mt-8 h-44 rounded bg-gray-50" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className={`${CARD} text-sm`}>
          <h2 className="font-semibold text-red-700">
            Unable to load North Star metrics
          </h2>
          <p className="mt-2 text-gray-600">{error}</p>
          <button
            onClick={() => submit(false)}
            className={`${BUTTON} mt-4 bg-indigo-600 text-white`}
          >
            Retry
          </button>
        </div>
      ) : (
        data && (
          <>
            <div
              className={`rounded-xl border p-4 text-sm leading-relaxed ${source === "historical" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-indigo-100 bg-indigo-50 text-indigo-900"}`}
            >
              <p className="font-semibold">
                {source === "historical"
                  ? "Historical estimates — use as a separate baseline"
                  : "New tracking · definition v1"}
              </p>
              <p className="mt-1">
                {source === "historical"
                  ? "Reconstructed from surviving records with UTC practice dates. Story marks can be removed, and older widget checks are incomplete. Do not join this line to new tracking."
                  : `Reliable activity capture began ${instant(data.capture_started_at)}. Widget snapshot coverage improves as users adopt build ${data.widget_observation_min_build}. ${data.status === "pending" ? data.status_reason : "Only mature cohorts are included."}`}
              </p>
              {source === "prospective" &&
                data.maturity.prospective_paid_week_rows === 0 && (
                  <p className="mt-2">
                    First fully tracked paid-learning week:{" "}
                    {formatPeriod(
                      data.maturity.first_full_paid_week_start,
                      "week",
                    )}
                    –
                    {formatPeriod(
                      data.maturity.first_full_paid_week_end,
                      "week",
                    )}
                    , followed by the 48-hour arrival buffer.
                  </p>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
              <p>
                Report through {instant(data.effective_end)} · latest 48 hours
                held back · weeks start Monday UTC
              </p>
              <p>
                Calculated {instant(data.cache.generated_at)} · cached for up to
                6 hours{data.cache.stale ? " · stale" : ""}
                {data.cache.refreshing ? " · refresh in progress" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="trial-store"
                className="text-sm font-medium text-gray-600"
              >
                Trial activation store
              </label>
              <select
                id="trial-store"
                value={activeStore}
                onChange={(event) => setStore(event.target.value)}
                className={DATE}
              >
                {stores.map((value) => (
                  <option key={value} value={value}>
                    {storeName(value)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400">
                Paid learning habit includes all attributable paid stores.
              </p>
            </div>
            <div className="grid items-start gap-6 xl:grid-cols-2">
              <MetricCard
                title="Trial activation"
                description="A widget plus a Daily Prompt submission, a studied story, or a completed flashcard goal in the first 48 hours."
                metric="activation"
                report={report}
                interval={interval}
                source={source}
                store={activeStore}
              />
              <MetricCard
                title="Paid learning habit"
                description="Paying subscribers who complete meaningful practice on at least two distinct days in a week."
                metric="habit"
                report={report}
                interval={interval}
                source={source}
                store={activeStore}
              />
            </div>
            <section className={CARD}>
              <h2 className="text-lg font-bold text-gray-900">
                Tracking health and coverage
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-gray-500">
                    Practice facts captured
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">
                    {number(data.capture_health.facts)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Capture errors</p>
                  <p
                    className={`mt-1 text-2xl font-semibold ${data.capture_health.capture_errors ? "text-red-600" : "text-gray-900"}`}
                  >
                    {number(data.capture_health.capture_errors)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">
                    Last activity captured
                  </p>
                  <p className="mt-2 text-sm text-gray-700">
                    {data.capture_health.last_fact_at
                      ? instant(data.capture_health.last_fact_at)
                      : "No activity captured yet"}
                  </p>
                </div>
              </div>
              {data.capture_health.capture_errors > 0 && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
                >
                  Capture errors may mean missing activity. Investigate before
                  interpreting changes in these rates.
                </p>
              )}
              {report && (
                <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-gray-100 pt-4 text-sm sm:grid-cols-2">
                  <Coverage
                    label="Trials with a successful widget check in 48h"
                    value={
                      report.coverage.trials_with_successful_native_check_48h
                    }
                  />
                  <Coverage
                    label="Trials without positive widget evidence"
                    value={
                      report.coverage.trials_without_positive_widget_evidence
                    }
                  />
                  <Coverage
                    label="Paid accounts excluded for billing ambiguity"
                    value={
                      report.coverage
                        .paid_charge_accounts_excluded_for_ambiguity
                    }
                  />
                  <Coverage
                    label="Practice facts using fallback UTC timezone"
                    value={report.coverage.practice_timezone_fallback}
                  />
                </dl>
              )}
              <details className="mt-5 border-t border-gray-100 pt-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-600">
                  Definitions and data limitations
                </summary>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-xs leading-relaxed text-gray-500">
                  {data.caveats
                    .filter(
                      (caveat) =>
                        !caveat.includes("On-demand aggregate report only"),
                    )
                    .map((caveat) => (
                      <li key={caveat}>{caveat}</li>
                    ))}
                  <li>
                    Opens, notification taps, individual flashcard ratings and
                    sentence-only reading do not qualify as meaningful practice.
                  </li>
                  <li>
                    Trial activation compares trial-start cohorts. Monthly paid
                    habit counts learner-weeks; a learner may enter multiple
                    weekly denominators.
                  </li>
                  <li>
                    Historical paid cohorts use attributable charged periods,
                    not current Pro status. Deleted and ambiguous accounts limit
                    coverage.
                  </li>
                </ul>
              </details>
            </section>
          </>
        )
      )}
    </main>
  );
}

function Coverage({
  label,
  value,
}: {
  label: string;
  value: number | string | null | undefined;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-800">
        {typeof value === "number" ? number(value) : (value ?? "—")}
      </dd>
    </div>
  );
}

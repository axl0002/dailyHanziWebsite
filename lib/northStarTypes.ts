/** admin_north_star_report(date,date,boolean); all dates/cutoffs are UTC. */
export interface TrialActivationPoint {
  trial_week: string;
  store: string | null;
  trials: number;
  activated: number;
  activation_pct: number | null;
  practiced_in_48h: number;
  widget_observed_in_48h: number;
  widget_known_before_trial: number;
  successful_snapshot_in_48h: number;
  fully_prospective: boolean;
}
export interface PaidHabitPoint {
  week_start: string;
  paying_at_start: number;
  practicing_two_days: number;
  habit_pct: number | null;
  diagnostic_three_days: number;
  fully_prospective: boolean;
  candidate_charge_accounts: number | null;
}
export interface TrialActivationMonth {
  month_start: string;
  store: string | null;
  trials: number;
  activated: number;
  activation_pct: number | null;
  full_month: boolean;
}
export interface PaidHabitMonth {
  month_start: string;
  paid_learner_weeks: number;
  habit_learner_weeks: number;
  habit_pct: number | null;
  full_month_of_week_starts: boolean;
}
export interface NorthStarMetricReport {
  definition_version: "hanzi_nsm_v1";
  practice_basis:
    | "append_only_server_capture_v1"
    | "legacy_surviving_history_proxy_utc";
  params: { start_at: string; as_of: string; capture_start: string };
  coverage: Record<string, number | string | null>;
  trial_activation_by_week: TrialActivationPoint[];
  weekly_paid_learning_habit: PaidHabitPoint[];
  monthly_trial_activation: TrialActivationMonth[];
  monthly_paid_habit: PaidHabitMonth[];
  paid_habit_by_tenure: Array<{
    week_start: string;
    paid_tenure: "paid_under_28d" | "paid_28d_plus";
    paying_at_start: number;
    practicing_two_days: number;
    habit_pct: number | null;
  }>;
  trial_to_paid_diagnostic: Array<{
    store: string | null;
    activated: boolean;
    mature_trials: number;
    paid: number;
    paid_pct: number | null;
  }>;
  renewal_diagnostic: Array<{
    met_two_days: boolean;
    expiring_paid_learner_weeks: number;
    renewed: number;
  }>;
}
export interface NorthStarDashboard {
  definition_version: "hanzi_nsm_v1";
  source_project: "derycifbrndfanjjfpve";
  generated_at: string;
  capture_started_at: string;
  effective_start: string;
  effective_end: string;
  widget_observation_min_build: 162;
  status: "pending" | "active";
  status_reason: string;
  maturity: {
    arrival_watermark_hours: 48;
    trial_window_hours: 48;
    first_full_paid_week_start: string;
    first_full_paid_week_end: string;
    prospective_trial_rows: number;
    prospective_paid_week_rows: number;
  };
  prospective: NorthStarMetricReport | null;
  historical_proxy: NorthStarMetricReport;
  capture_health: {
    capture_errors: number;
    facts: number;
    last_fact_at: string | null;
    activities: Array<{ activity: string; facts: number }> | null;
  };
  cache: {
    hit: boolean;
    generated_at: string;
    expires_at: string;
    stale: boolean;
    refreshing: boolean;
  };
  caveats: string[];
}

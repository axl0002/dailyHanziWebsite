"use client";

import HSKLevelChart from './HSKLevelChart';
import ReasonChart from './ReasonChart';
import ReferralChart from './ReferralChart';
import CategoryChart from './CategoryChart';
import ReadingHoursChart from './ReadingHoursChart';
import ContinentChart from './ContinentChart';
import CountryChart from './CountryChart';
import TimezoneChart from './TimezoneChart';
import PlatformChart from './PlatformChart';
import ThemeChart from './ThemeChart';
import TraditionalSimplifiedChart from './TraditionalSimplifiedChart';

import DailySentenceCountChart from './DailySentenceCountChart';
import PinyinEnabledChart from './PinyinEnabledChart';
import SentencesReadChart from './SentencesReadChart';
import StoriesReadChart from './StoriesReadChart';
import SavedCharactersChart from './SavedCharactersChart';
import LearnedCharactersChart from './LearnedCharactersChart';
import InReviewCharactersChart from './InReviewCharactersChart';
import WidgetInstallsChart from './WidgetInstallsChart';
import WidgetInstallBreakdownChart from './WidgetInstallBreakdownChart';
import WidgetTapsChart from './WidgetTapsChart';
import NotificationTapsChart from './NotificationTapsChart';

type ProFilter = 'all' | 'true' | 'false';
type DateRange = 'all' | '30d' | '7d';

// The set of non-revenue analytics rendered on both /admin/analytics
// (moderator-accessible) and /admin/dashboard (admin-only). Extracted here so
// both pages stay in sync when we add/remove a chart.
//
// Two visual sections split on where the data is captured in the funnel:
//   1. Pre-paywall — attributes/demographics captured during onboarding,
//      before the user encounters the paywall. Available for every user
//      (Pro + Free), so the Pro/Free toolbar toggle meaningfully splits.
//   2. Post-paywall — Pro-gated features/settings. Free users mechanically
//      can't produce this data, so the charts always show the Pro cohort.
//
// Section dividers use col-span-full so they span the whole grid regardless
// of the parent's column count.
export default function AnalyticsGrid({ filter, dateRange }: { filter: ProFilter; dateRange: DateRange }) {
    return (
        <>
            {/* --- Section 1: Pre-paywall --- */}
            <div className="col-span-full">
                <h2 className="text-lg font-semibold text-gray-900">Pre-paywall</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                    Attributes captured during onboarding, before the user sees the paywall — demographics, survey answers, defaults.
                </p>
            </div>

            <PlatformChart filter={filter} dateRange={dateRange} />
            <HSKLevelChart filter={filter} dateRange={dateRange} />
            <ThemeChart filter={filter} dateRange={dateRange} />
            <TraditionalSimplifiedChart filter={filter} dateRange={dateRange} />
            <ReadingHoursChart filter={filter} dateRange={dateRange} />
            <ReasonChart filter={filter} dateRange={dateRange} />
            <ReferralChart filter={filter} dateRange={dateRange} />
            <ContinentChart filter={filter} dateRange={dateRange} />
            <CategoryChart filter={filter} dateRange={dateRange} />
            <CountryChart filter={filter} dateRange={dateRange} />
            <TimezoneChart filter={filter} dateRange={dateRange} />

            {/* --- Section 2: Post-paywall --- */}
            <div className="col-span-full mt-4">
                <h2 className="text-lg font-semibold text-gray-900">Post-paywall</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                    Pro-gated settings and behaviors. Free users can&apos;t produce this data, so charts always show the Pro cohort.
                </p>
            </div>

            <DailySentenceCountChart filter={filter} dateRange={dateRange} />
            <PinyinEnabledChart filter={filter} dateRange={dateRange} />
            <SentencesReadChart filter={filter} dateRange={dateRange} />
            <StoriesReadChart filter={filter} dateRange={dateRange} />
            <SavedCharactersChart filter={filter} dateRange={dateRange} />
            <LearnedCharactersChart filter={filter} dateRange={dateRange} />
            <InReviewCharactersChart filter={filter} dateRange={dateRange} />
            <WidgetInstallsChart filter={filter} dateRange={dateRange} />
            <WidgetInstallBreakdownChart filter={filter} dateRange={dateRange} />
            <WidgetTapsChart filter={filter} dateRange={dateRange} />
            <NotificationTapsChart filter={filter} dateRange={dateRange} />
        </>
    );
}

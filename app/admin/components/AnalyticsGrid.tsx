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

type ProFilter = 'all' | 'true' | 'false';
type DateRange = 'all' | '30d' | '7d';

// The set of non-revenue analytics rendered on both /admin/analytics
// (moderator-accessible) and /admin/dashboard (admin-only). Extracted here so
// both pages stay in sync when we add/remove a chart.
//
// Two visual sections:
//   1. General user characteristics — settings/attributes any user has
//   2. Pro-only features — features Free users can't access, so the split
//      to Pro/Free wouldn't be meaningful. These charts always show Pro data.
//
// Section dividers use col-span-full so they span the whole grid regardless
// of the parent's column count.
export default function AnalyticsGrid({ filter, dateRange }: { filter: ProFilter; dateRange: DateRange }) {
    return (
        <>
            {/* --- Section 1: General user characteristics --- */}
            <div className="col-span-full">
                <h2 className="text-lg font-semibold text-gray-900">General user characteristics</h2>
                <p className="text-sm text-gray-500 mt-0.5">Settings and demographics across the full user base.</p>
            </div>

            <PlatformChart filter={filter} dateRange={dateRange} />
            <HSKLevelChart filter={filter} dateRange={dateRange} />
            <ThemeChart filter={filter} dateRange={dateRange} />
            <TraditionalSimplifiedChart filter={filter} dateRange={dateRange} />
            <ReadingHoursChart filter={filter} dateRange={dateRange} />
            <ReasonChart filter={filter} dateRange={dateRange} />
            <ReferralChart filter={filter} dateRange={dateRange} />
            <CategoryChart filter={filter} dateRange={dateRange} />
            <ContinentChart filter={filter} dateRange={dateRange} />
            <CountryChart filter={filter} dateRange={dateRange} />
            <TimezoneChart filter={filter} dateRange={dateRange} />

            {/* --- Section 2: Pro-only features --- */}
            <div className="col-span-full mt-4">
                <h2 className="text-lg font-semibold text-gray-900">Pro-only features</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                    These settings and behaviors are only available to Pro users, so charts always show the Pro cohort.
                </p>
            </div>

            <DailySentenceCountChart filter={filter} dateRange={dateRange} />
            <PinyinEnabledChart filter={filter} dateRange={dateRange} />
            <SentencesReadChart filter={filter} dateRange={dateRange} />
            <StoriesReadChart filter={filter} dateRange={dateRange} />
        </>
    );
}

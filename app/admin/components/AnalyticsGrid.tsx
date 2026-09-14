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

import DailySentenceCountChart from './DailySentenceCountChart';
import ThemeChart from './ThemeChart';
import TraditionalSimplifiedChart from './TraditionalSimplifiedChart';
import SentencesReadChart from './SentencesReadChart';
import StoriesReadChart from './StoriesReadChart';

type ProFilter = 'all' | 'true' | 'false';
type DateRange = 'all' | '30d' | '7d';

// The set of non-revenue analytics rendered on both /admin/analytics
// (moderator-accessible) and /admin/dashboard (admin-only). Extracted here so
// both pages stay in sync when we add/remove a chart.
export default function AnalyticsGrid({ filter, dateRange }: { filter: ProFilter; dateRange: DateRange }) {
    return (
        <>
            {/* Content engagement — histograms of user activity */}
            <SentencesReadChart dateRange={dateRange} />
            <StoriesReadChart dateRange={dateRange} />

            {/* Profile characteristics — new charts */}
            <DailySentenceCountChart filter={filter} dateRange={dateRange} />
            <ThemeChart filter={filter} dateRange={dateRange} />
            <TraditionalSimplifiedChart filter={filter} dateRange={dateRange} />

            {/* Existing distribution charts */}
            <HSKLevelChart filter={filter} />
            <ReadingHoursChart filter={filter} />
            <ReasonChart filter={filter} />
            <ReferralChart filter={filter} />
            <CategoryChart filter={filter} />
            <ContinentChart filter={filter} />
            <CountryChart filter={filter} />
            <TimezoneChart filter={filter} />
            <PlatformChart filter={filter} />
        </>
    );
}

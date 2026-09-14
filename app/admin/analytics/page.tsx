"use client";

import { useState } from 'react';

import HSKLevelChart from '../components/HSKLevelChart';
import ReasonChart from '../components/ReasonChart';
import ReferralChart from '../components/ReferralChart';
import CategoryChart from '../components/CategoryChart';
import ReadingHoursChart from '../components/ReadingHoursChart';
import ContinentChart from '../components/ContinentChart';
import CountryChart from '../components/CountryChart';
import TimezoneChart from '../components/TimezoneChart';
import PlatformChart from '../components/PlatformChart';

import DailySentenceCountChart from '../components/DailySentenceCountChart';
import ThemeChart from '../components/ThemeChart';
import TraditionalSimplifiedChart from '../components/TraditionalSimplifiedChart';
import SentencesReadChart from '../components/SentencesReadChart';
import StoriesReadChart from '../components/StoriesReadChart';

type ProFilter = 'all' | 'true' | 'false';
type DateRange = 'all' | '30d' | '7d';

// Non-revenue analytics visible to both admins and moderators. The revenue-
// sensitive charts (cancellation, trial cancellation, pro %, etc.) stay on
// /admin/dashboard which is admin-only in middleware.ts.
//
// The date range applies to charts that support it (the new ones on this page).
// Existing distribution charts are always all-time.
export default function AnalyticsPage() {
    const [filter, setFilter] = useState<ProFilter>('all');
    const [dateRange, setDateRange] = useState<DateRange>('all');

    return (
        <div className="p-6">
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
                    <p className="text-gray-600 mt-1">Non-revenue user analytics — profile characteristics, content engagement, and geography.</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="bg-white p-1 rounded-lg border border-gray-200 flex shadow-sm">
                        <button
                            onClick={() => setDateRange('all')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${dateRange === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            All time
                        </button>
                        <button
                            onClick={() => setDateRange('30d')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${dateRange === '30d' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            Last 30d
                        </button>
                        <button
                            onClick={() => setDateRange('7d')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${dateRange === '7d' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            Last 7d
                        </button>
                    </div>
                    <div className="bg-white p-1 rounded-lg border border-gray-200 flex shadow-sm">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            All Users
                        </button>
                        <button
                            onClick={() => setFilter('true')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'true' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            Pro
                        </button>
                        <button
                            onClick={() => setFilter('false')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'false' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            Free
                        </button>
                    </div>
                    <p className="text-xs text-gray-400 text-right max-w-xs">
                        Time range applies to charts that support it. Existing distribution charts show all-time.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Content engagement — spans two columns */}
                <SentencesReadChart dateRange={dateRange} />
                <StoriesReadChart dateRange={dateRange} />

                {/* Profile characteristics (new) */}
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
            </div>
        </div>
    );
}

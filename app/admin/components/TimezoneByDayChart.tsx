"use client";

import { useEffect, useState, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { supabase } from '@/lib/supabase';
import DateLabelModal from './DateLabelModal';
import ClickableXAxisTick from './ClickableXAxisTick';
import StackedReferenceLabel, { assignLabelRows, topMarginForLabelRows } from './StackedReferenceLabel';
import { DateLabel } from './useDateLabels';
import { resolveTimezoneCountry } from '@/lib/timezoneToCountry';

type ChartData = {
    date: string;
    total: number;
    [key: string]: string | number;
};

type Profile = {
    created_at: string;
    is_pro: boolean | null;
    timezone: string | null;
};

type Props = {
    filter?: 'all' | 'true' | 'false';
    dateLabels: Record<string, DateLabel[]>;
    onAddLabel: (date: string, label: string) => Promise<void>;
    onDeleteLabel: (id: string) => Promise<void>;
};

function formatDateLabel(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
}

// Map an IANA timezone (e.g. "America/New_York") to a continent bucket.
// Handles a few special cases where the first segment isn't a continent.
function timezoneToContinent(tz: string): string | null {
    if (!tz) return null;
    const trimmed = tz.trim();
    if (!trimmed) return null;

    const firstSegment = trimmed.split('/')[0];

    switch (firstSegment) {
        case 'Africa':
            return 'Africa';
        case 'America':
            return 'Americas';
        case 'Antarctica':
            return 'Antarctica';
        case 'Arctic':
            return 'Arctic';
        case 'Asia':
            return 'Asia';
        case 'Atlantic':
            return 'Atlantic';
        case 'Australia':
            return 'Oceania';
        case 'Pacific':
            return 'Oceania';
        case 'Indian':
            return 'Indian Ocean';
        case 'Europe':
            return 'Europe';
        case 'US':
        case 'Canada':
            return 'Americas';
        case 'Etc':
        case 'UTC':
        case 'GMT':
            return 'UTC/Other';
        default:
            return 'Other';
    }
}

const COLORS = [
    '#6366F1', // indigo
    '#10B981', // emerald
    '#F59E0B', // amber
    '#EF4444', // red
    '#8B5CF6', // violet
    '#14B8A6', // teal
    '#EC4899', // pink
    '#3B82F6', // blue
    '#F97316', // orange
    '#84CC16', // lime
    '#CBD5E1', // slate (fallback)
];

type GroupMode = 'continent' | 'country';

const GROUP_COLOR_MAP: Record<string, string> = {};
let nextColorIndex = 0;
function getGroupColor(key: string): string {
    if (!(key in GROUP_COLOR_MAP)) {
        GROUP_COLOR_MAP[key] = COLORS[nextColorIndex % COLORS.length];
        nextColorIndex++;
    }
    return GROUP_COLOR_MAP[key];
}

export default function TimezoneByDayChart({ filter, dateLabels, onAddLabel, onDeleteLabel }: Props) {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState<14 | 30 | 60 | 90>(14);
    const [pageOffset, setPageOffset] = useState(0);
    const [earliestDate, setEarliestDate] = useState<string | null>(null);
    const [labelModal, setLabelModal] = useState<{ date: string; position: { x: number; y: number } } | null>(null);
    const [groupMode, setGroupMode] = useState<GroupMode>('continent');

    useEffect(() => {
        const fetchEarliest = async () => {
            const { data } = await supabase
                .from('profiles')
                .select('created_at')
                .eq('is_beta', false)
                .order('created_at', { ascending: true })
                .limit(1);
            if (data && data.length > 0) {
                setEarliestDate(data[0].created_at.split('T')[0]);
            }
        };
        fetchEarliest();
    }, []);

    const getDateWindow = useCallback(() => {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - pageOffset * days);
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0, 0, 0, 0);

        return { startDate, endDate };
    }, [days, pageOffset]);

    const canGoBack = useCallback(() => {
        if (!earliestDate) return false;
        const { startDate } = getDateWindow();
        const earliest = new Date(earliestDate);
        earliest.setHours(0, 0, 0, 0);
        return startDate > earliest;
    }, [earliestDate, getDateWindow]);

    // Fetch profiles within the visible window. groupMode / Top-N changes are pure
    // client-side re-aggregations of this list; changing the day-window / page refetches
    // so we only ever pull rows in range rather than scanning the whole table.
    useEffect(() => {
        let cancelled = false;
        const fetchProfiles = async () => {
            setLoading(true);

            const { startDate, endDate } = getDateWindow();

            // Padded ±1 day to cover the local/UTC date-bucketing boundary.
            const queryStart = new Date(startDate);
            queryStart.setDate(queryStart.getDate() - 1);
            const queryEnd = new Date(endDate);
            queryEnd.setDate(queryEnd.getDate() + 1);

            let allProfiles: Profile[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;

                let query = supabase
                    .from('profiles')
                    .select('created_at, is_pro, timezone')
                    .eq('is_beta', false)
                    .gte('created_at', queryStart.toISOString())
                    .lte('created_at', queryEnd.toISOString())
                    .order('created_at', { ascending: true })
                    .range(from, to);

                if (filter === 'true') {
                    query = query.eq('is_pro', true);
                } else if (filter === 'false') {
                    query = query.eq('is_pro', false);
                }

                const { data: batch, error } = await query;

                if (error) {
                    console.error('Error fetching profiles:', error);
                    if (!cancelled) setLoading(false);
                    return;
                }

                if (batch && batch.length > 0) {
                    allProfiles = [...allProfiles, ...batch];
                    if (batch.length < pageSize) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }

                page++;
                if (allProfiles.length > 50000) {
                    console.warn('Reached safety limit of 50k profiles');
                    hasMore = false;
                }
            }

            if (cancelled) return;
            setProfiles(allProfiles);
            setLoading(false);
        };

        fetchProfiles();
        return () => { cancelled = true; };
    }, [filter, getDateWindow]);

    // Derive chart data from cached profiles. Recomputes instantly on toggle/day change.
    const { data, groups, debugInfo, unmappedZones, dailyBreakdown } = useMemo(() => {
        const { endDate } = getDateWindow();

        // Initialize date buckets for the visible window
        const dailyStats: Record<string, Record<string, number>> = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(endDate);
            d.setDate(d.getDate() - i);
            const dateString = d.toISOString().split('T')[0];
            dailyStats[dateString] = {};
        }

        let inPeriodCount = 0;
        // Track unmapped raw IANA zones within the visible date window so we can
        // surface missing mappings to the user.
        const unmappedCounts: Record<string, number> = {};

        profiles.forEach((profile) => {
            if (!profile.created_at) return;

            const profileDate = new Date(profile.created_at);
            const dateString = profileDate.toISOString().split('T')[0];

            if (!dailyStats[dateString]) return;

            let group: string | null = null;
            if (profile.timezone) {
                if (groupMode === 'continent') {
                    group = timezoneToContinent(profile.timezone);
                } else {
                    const result = resolveTimezoneCountry(profile.timezone);
                    if (result) {
                        if (result.kind === 'mapped') {
                            group = result.country;
                        } else if (result.kind === 'utc') {
                            group = 'UTC/Other';
                        } else {
                            group = 'Unknown';
                            unmappedCounts[result.raw] = (unmappedCounts[result.raw] || 0) + 1;
                        }
                    }
                }
            }

            if (group) {
                dailyStats[dateString][group] = (dailyStats[dateString][group] || 0) + 1;
                inPeriodCount++;
            }
        });

        // Get all groups sorted by total count descending
        const groupTotals: Record<string, number> = {};
        Object.values(dailyStats).forEach(dayCounts => {
            Object.entries(dayCounts).forEach(([g, count]) => {
                groupTotals[g] = (groupTotals[g] || 0) + count;
            });
        });
        const sortedGroups = Object.entries(groupTotals)
            .sort((a, b) => b[1] - a[1])
            .map(([g]) => g);

        // In country mode keep the top 15 countries visible and roll the rest into
        // a single "Other" stack. Continent mode always renders every continent.
        const COUNTRY_VISIBLE = 15;
        const shouldBucketOther = groupMode === 'country' && sortedGroups.length > COUNTRY_VISIBLE;
        const topGroups = shouldBucketOther ? sortedGroups.slice(0, COUNTRY_VISIBLE) : sortedGroups;
        const tailGroups = shouldBucketOther ? sortedGroups.slice(COUNTRY_VISIBLE) : [];
        const finalGroups = shouldBucketOther ? [...topGroups, 'Other'] : topGroups;

        // Build chart data — top-15 countries as their own stacks plus an "Other" sum.
        const chartData = Object.entries(dailyStats)
            .map(([date, counts]) => {
                const entry: ChartData = { date, total: 0 };
                topGroups.forEach(g => {
                    entry[g] = counts[g] || 0;
                    entry.total += counts[g] || 0;
                });
                if (shouldBucketOther) {
                    const otherSum = tailGroups.reduce((sum, g) => sum + (counts[g] || 0), 0);
                    entry['Other'] = otherSum;
                    entry.total += otherSum;
                }
                return entry;
            })
            .sort((a, b) => a.date.localeCompare(b.date));

        const unmappedSorted = Object.entries(unmappedCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([raw, count]) => ({ raw, count }));

        // Full per-day breakdown (every group) — used by the tooltip so hovering a
        // day shows every country/continent represented that day, sorted by size.
        const dailyBreakdown: Record<string, Array<{ name: string; count: number }>> = {};
        Object.entries(dailyStats).forEach(([date, counts]) => {
            dailyBreakdown[date] = Object.entries(counts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count);
        });

        return {
            data: chartData,
            groups: finalGroups,
            debugInfo: { fetched: profiles.length, totalInPeriod: inPeriodCount },
            unmappedZones: unmappedSorted,
            dailyBreakdown,
        };
    }, [profiles, days, groupMode, getDateWindow]);

    // Log unmapped zones to the console whenever country mode is active — makes
    // it easy to grab the list and add mappings.
    useEffect(() => {
        if (groupMode !== 'country') return;
        if (unmappedZones.length === 0) return;
        console.warn(
            `[TimezoneByDayChart] ${unmappedZones.length} unmapped IANA timezones in country mode:`,
            unmappedZones,
        );
    }, [groupMode, unmappedZones]);

    const [showUnmapped, setShowUnmapped] = useState(false);
    const totalUnmapped = unmappedZones.reduce((sum, z) => sum + z.count, 0);

    const { startDate, endDate } = getDateWindow();
    const startLabel = formatDateLabel(startDate.toISOString().split('T')[0]);
    const endLabel = formatDateLabel(endDate.toISOString().split('T')[0]);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const showSevenDayLine = data.some(d => d.date === sevenDaysAgoStr);

    // Assign each event label a row index so neighboring labels don't overlap.
    const { visibleLabels, chartTopMargin } = useMemo(() => {
        const raw = data
            .filter(d => dateLabels[d.date]?.length > 0)
            .map(d => ({
                date: d.date,
                labels: dateLabels[d.date].map(dl => dl.label),
            }));
        const withRows = assignLabelRows(raw, days);
        const maxRow = withRows.reduce((m, e) => Math.max(m, e.row), 0);
        return { visibleLabels: withRows, chartTopMargin: topMarginForLabelRows(maxRow) };
    }, [data, dateLabels, days]);

    const handleDateClick = (date: string, clientX: number, clientY: number) => {
        setLabelModal({
            date,
            position: { x: Math.min(clientX, window.innerWidth - 300), y: Math.max(10, clientY - 200) }
        });
    };

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px]">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
                <h3 className="text-lg font-bold text-gray-900">Location by Day ({groupMode === 'continent' ? 'Continent' : 'Country'})</h3>
                <div className="flex items-center gap-2">
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                        <button className={`px-3 py-1 text-xs font-medium rounded ${groupMode === 'continent' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>Continent</button>
                        <button className={`px-3 py-1 text-xs font-medium rounded ${groupMode === 'country' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>Country</button>
                    </div>
                    <button disabled className="p-1.5 rounded-md text-gray-300 border border-gray-100">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                        <button className={`px-3 py-1 text-xs font-medium rounded ${days === 14 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>14d</button>
                        <button className={`px-3 py-1 text-xs font-medium rounded ${days === 30 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>30d</button>
                        <button className={`px-3 py-1 text-xs font-medium rounded ${days === 60 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>60d</button>
                        <button className={`px-3 py-1 text-xs font-medium rounded ${days === 90 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}>90d</button>
                    </div>
                    <button disabled className="p-1.5 rounded-md text-gray-300 border border-gray-100">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                </div>
            </div>
            <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-400">Loading chart data...</span>
            </div>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-1 md:col-span-2">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-gray-900">Location by Day ({groupMode === 'continent' ? 'Continent' : 'Country'})</h3>
                    <span className="text-sm text-gray-500">{startLabel} – {endLabel}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                        <button
                            onClick={() => setGroupMode('continent')}
                            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${groupMode === 'continent' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Continent
                        </button>
                        <button
                            onClick={() => setGroupMode('country')}
                            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${groupMode === 'country' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Country
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={() => setPageOffset(prev => prev + 1)}
                            disabled={!canGoBack()}
                            className={`p-1.5 rounded-md border transition-colors ${canGoBack() ? 'text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900' : 'text-gray-300 border-gray-100 cursor-not-allowed'}`}
                            title="Previous period"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                        </button>
                        <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                            <button
                                onClick={() => { setDays(14); setPageOffset(0); }}
                                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 14 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                14d
                            </button>
                            <button
                                onClick={() => { setDays(30); setPageOffset(0); }}
                                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 30 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                30d
                            </button>
                            <button
                                onClick={() => { setDays(60); setPageOffset(0); }}
                                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 60 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                60d
                            </button>
                            <button
                                onClick={() => { setDays(90); setPageOffset(0); }}
                                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 90 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                90d
                            </button>
                        </div>
                        <button
                            onClick={() => setPageOffset(prev => Math.max(0, prev - 1))}
                            disabled={pageOffset === 0}
                            className={`p-1.5 rounded-md border transition-colors ${pageOffset > 0 ? 'text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900' : 'text-gray-300 border-gray-100 cursor-not-allowed'}`}
                            title="Next period"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        </button>
                    </div>
                    <span className="text-xs text-gray-400">
                        {debugInfo.totalInPeriod} users in period ({debugInfo.fetched} total scanned)
                    </span>
                </div>
            </div>
            {groupMode === 'country' && unmappedZones.length > 0 && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <button
                        onClick={() => setShowUnmapped(prev => !prev)}
                        className="flex w-full items-center justify-between text-left text-amber-800 font-medium"
                    >
                        <span>
                            ⚠ {unmappedZones.length} unmapped timezone{unmappedZones.length === 1 ? '' : 's'} in window ({totalUnmapped} user{totalUnmapped === 1 ? '' : 's'}) bucketed as &ldquo;Unknown&rdquo;
                        </span>
                        <span className="text-amber-700">{showUnmapped ? 'Hide' : 'Show'}</span>
                    </button>
                    {showUnmapped && (
                        <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-amber-900 font-mono">
                            {unmappedZones.map(z => (
                                <li key={z.raw} className="flex justify-between">
                                    <span className="truncate">{z.raw}</span>
                                    <span className="text-amber-700">{z.count}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={data}
                        margin={{ top: chartTopMargin, right: 30, left: 20, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            dataKey="date"
                            tick={<ClickableXAxisTick dateLabels={dateLabels} onDateClick={handleDateClick} totalDays={days} />}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                            height={days > 30 ? 60 : 30}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            wrapperStyle={{ zIndex: 50, outline: 'none' }}
                            content={({ active, payload, label }) => {
                                if (!active || !payload || payload.length === 0) return null;

                                let formattedLabel = label;
                                if (typeof label === 'string') {
                                    const dateParts = label.split('-');
                                    if (dateParts.length === 3) {
                                        formattedLabel = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;
                                    }
                                }

                                const fullBreakdown = typeof label === 'string' ? dailyBreakdown[label] || [] : [];
                                const total = fullBreakdown.reduce((sum, b) => sum + b.count, 0);
                                const dateLabelList = typeof label === 'string' ? dateLabels[label] : undefined;

                                // Confine the tooltip to the same top-15 countries rendered in the
                                // stack, with the remainder summed into "Other" — this keeps the
                                // tooltip in sync with the bar segments.
                                const hasOther = groups[groups.length - 1] === 'Other';
                                const topSet = new Set(hasOther ? groups.slice(0, -1) : groups);
                                let displayEntries: Array<{ name: string; count: number }>;
                                if (hasOther) {
                                    const topEntries = fullBreakdown.filter(b => topSet.has(b.name));
                                    const otherSum = fullBreakdown
                                        .filter(b => !topSet.has(b.name))
                                        .reduce((s, b) => s + b.count, 0);
                                    displayEntries = otherSum > 0
                                        ? [...topEntries, { name: 'Other', count: otherSum }]
                                        : topEntries;
                                } else {
                                    displayEntries = fullBreakdown;
                                }

                                return (
                                    <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[180px]">
                                        <p className="font-semibold text-gray-900 mb-2">{formattedLabel}</p>
                                        {dateLabelList && dateLabelList.length > 0 && dateLabelList.map((dl) => (
                                            <p key={dl.id} className="text-xs font-medium text-amber-600 mb-1 flex items-center gap-1">
                                                <span>&#9873;</span> {dl.label}
                                            </p>
                                        ))}
                                        {displayEntries.map((entry) => {
                                            const percentage = total > 0 ? ((entry.count / total) * 100).toFixed(1) : '0.0';
                                            const color = entry.name === 'Other' || entry.name === 'Unknown' || entry.name === 'UTC/Other'
                                                ? '#CBD5E1'
                                                : getGroupColor(entry.name);

                                            return (
                                                <div key={entry.name} className="flex items-center justify-between gap-4 mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className="w-2 h-2 rounded-full shrink-0"
                                                            style={{ backgroundColor: color }}
                                                        />
                                                        <span className="text-sm font-medium text-gray-700 truncate">
                                                            {entry.name}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm font-bold text-gray-700 shrink-0">
                                                        {entry.count} ({percentage}%)
                                                    </span>
                                                </div>
                                            );
                                        })}
                                        {displayEntries.length > 0 && (
                                            <div className="border-t border-gray-100 mt-1 pt-1 flex items-center justify-between">
                                                <span className="text-sm font-medium text-gray-500">Total</span>
                                                <span className="text-sm font-bold text-gray-900">{total}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            }}
                        />
                        {showSevenDayLine && (
                            <ReferenceLine
                                x={sevenDaysAgoStr}
                                stroke="#9CA3AF"
                                strokeDasharray="4 4"
                                label={{ value: '7d ago', position: 'top', fill: '#9CA3AF', fontSize: 11 }}
                            />
                        )}
                        {visibleLabels.map(({ date, labels: lbls, row }) => (
                            <ReferenceLine
                                key={date}
                                x={date}
                                stroke="#F59E0B"
                                strokeDasharray="3 3"
                                strokeWidth={2}
                                label={<StackedReferenceLabel labels={lbls} rowOffset={row} />}
                            />
                        ))}
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {groups.map((g, i) => (
                            <Bar
                                key={g}
                                dataKey={g}
                                name={g}
                                stackId="timezone"
                                fill={g === 'Other' ? '#CBD5E1' : getGroupColor(g)}
                                radius={i === groups.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {labelModal && (
                <DateLabelModal
                    date={labelModal.date}
                    existingLabels={dateLabels[labelModal.date] || []}
                    position={labelModal.position}
                    onAdd={onAddLabel}
                    onDelete={onDeleteLabel}
                    onClose={() => setLabelModal(null)}
                />
            )}
        </div>
    );
}

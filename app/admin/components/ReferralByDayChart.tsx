"use client";

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { supabase } from '@/lib/supabase';
import DateLabelModal from './DateLabelModal';
import ClickableXAxisTick from './ClickableXAxisTick';
import StackedReferenceLabel, { assignLabelRows, topMarginForLabelRows } from './StackedReferenceLabel';
import { DateLabel } from './useDateLabels';

type ChartData = {
    date: string;
    total: number;
    [key: string]: string | number;
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

const COLORS = [
    '#6366F1', // indigo
    '#F59E0B', // amber
    '#10B981', // emerald
    '#EF4444', // red
    '#8B5CF6', // violet
    '#EC4899', // pink
    '#14B8A6', // teal
    '#F97316', // orange
    '#3B82F6', // blue
    '#84CC16', // lime
    '#CBD5E1', // slate (fallback)
];

// Stable color assignment: each source always gets the same color regardless of sort order
const SOURCE_COLOR_MAP: Record<string, string> = {};
let nextColorIndex = 0;
function getSourceColor(source: string): string {
    if (!(source in SOURCE_COLOR_MAP)) {
        SOURCE_COLOR_MAP[source] = COLORS[nextColorIndex % COLORS.length];
        nextColorIndex++;
    }
    return SOURCE_COLOR_MAP[source];
}

export default function ReferralByDayChart({ filter, dateLabels, onAddLabel, onDeleteLabel }: Props) {
    const [data, setData] = useState<ChartData[]>([]);
    const [sources, setSources] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [debugInfo, setDebugInfo] = useState({ fetched: 0, totalInPeriod: 0 });
    const [days, setDays] = useState<14 | 30 | 60 | 90>(14);
    const [pageOffset, setPageOffset] = useState(0);
    const [earliestDate, setEarliestDate] = useState<string | null>(null);
    const [labelModal, setLabelModal] = useState<{ date: string; position: { x: number; y: number } } | null>(null);

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

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            const { startDate, endDate } = getDateWindow();

            // Only fetch profiles within the visible window (padded ±1 day to cover the
            // local/UTC date-bucketing boundary). Keeps each query bounded to the window
            // instead of scanning the whole table as the userbase grows.
            const queryStart = new Date(startDate);
            queryStart.setDate(queryStart.getDate() - 1);
            const queryEnd = new Date(endDate);
            queryEnd.setDate(queryEnd.getDate() + 1);

            let allProfiles: { created_at: string; survey_responses: Record<string, unknown> | null; is_pro: boolean | null }[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;

                let query = supabase
                    .from('profiles')
                    .select('created_at, survey_responses, is_pro')
                    .eq('is_beta', false)
                    .gte('created_at', queryStart.toISOString())
                    .lte('created_at', queryEnd.toISOString())
                    .order('created_at', { ascending: true })
                    .order('id', { ascending: true })
                    .range(from, to);

                if (filter === 'true') {
                    query = query.eq('is_pro', true);
                } else if (filter === 'false') {
                    query = query.eq('is_pro', false);
                }

                const { data: batch, error } = await query;

                if (error) {
                    console.error('Error fetching profiles:', error);
                    setLoading(false);
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

            const profiles = allProfiles;

            // Initialize date buckets
            const dailyStats: Record<string, Record<string, number>> = {};
            for (let i = 0; i < days; i++) {
                const d = new Date(endDate);
                d.setDate(d.getDate() - i);
                const dateString = d.toISOString().split('T')[0];
                dailyStats[dateString] = {};
            }

            const sourceSet = new Set<string>();
            let inPeriodCount = 0;

            profiles?.forEach((profile) => {
                if (!profile.created_at) return;

                const profileDate = new Date(profile.created_at);
                const dateString = profileDate.toISOString().split('T')[0];

                if (dailyStats[dateString]) {
                    const responses = profile.survey_responses;
                    if (responses && typeof responses === 'object' && !Array.isArray(responses)) {
                        const source = responses['referral_source'];
                        if (source && typeof source === 'string') {
                            const key = source.trim();
                            sourceSet.add(key);
                            dailyStats[dateString][key] = (dailyStats[dateString][key] || 0) + 1;
                            inPeriodCount++;
                        }
                    }
                }
            });

            // Get all sources sorted by total count descending
            const sourceTotals: Record<string, number> = {};
            Object.values(dailyStats).forEach(dayCounts => {
                Object.entries(dayCounts).forEach(([src, count]) => {
                    sourceTotals[src] = (sourceTotals[src] || 0) + count;
                });
            });
            const sortedSources = Object.entries(sourceTotals)
                .sort((a, b) => b[1] - a[1])
                .map(([src]) => src);

            // Build chart data
            const chartData = Object.entries(dailyStats)
                .map(([date, counts]) => {
                    const entry: ChartData = { date, total: 0 };
                    sortedSources.forEach(src => {
                        entry[src] = counts[src] || 0;
                        entry.total += counts[src] || 0;
                    });
                    return entry;
                })
                .sort((a, b) => a.date.localeCompare(b.date));

            setData(chartData);
            setSources(sortedSources);
            setDebugInfo({
                fetched: profiles?.length || 0,
                totalInPeriod: inPeriodCount
            });
            setLoading(false);
        };

        fetchData();
    }, [filter, days, pageOffset, getDateWindow]);

    const { startDate, endDate } = getDateWindow();
    const startLabel = formatDateLabel(startDate.toISOString().split('T')[0]);
    const endLabel = formatDateLabel(endDate.toISOString().split('T')[0]);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const showSevenDayLine = data.some(d => d.date === sevenDaysAgoStr);

    const rawLabels = data
        .filter(d => dateLabels[d.date]?.length > 0)
        .map(d => ({
            date: d.date,
            labels: dateLabels[d.date].map(dl => dl.label)
        }));
    const visibleLabels = assignLabelRows(rawLabels, days);
    const maxLabelRow = visibleLabels.reduce((m, e) => Math.max(m, e.row), 0);
    const chartTopMargin = topMarginForLabelRows(maxLabelRow);

    const handleDateClick = (date: string, clientX: number, clientY: number) => {
        setLabelModal({
            date,
            position: { x: Math.min(clientX, window.innerWidth - 300), y: Math.max(10, clientY - 200) }
        });
    };

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px]">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
                <h3 className="text-lg font-bold text-gray-900">Referral Sources by Day</h3>
                <div className="flex items-center gap-2">
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
                    <h3 className="text-lg font-bold text-gray-900">Referral Sources by Day</h3>
                    <span className="text-sm text-gray-500">{startLabel} – {endLabel}</span>
                </div>
                <div className="flex items-center gap-3">
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
                        {debugInfo.totalInPeriod} referrals in period ({debugInfo.fetched} total scanned)
                    </span>
                </div>
            </div>
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
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    let formattedLabel = label;
                                    if (typeof label === 'string') {
                                        const dateParts = label.split('-');
                                        if (dateParts.length === 3) {
                                            formattedLabel = `${dateParts[1]}/${dateParts[2]}/${dateParts[0]}`;
                                        }
                                    }

                                    const total = (payload[0]?.payload as ChartData)?.total || 0;
                                    // Filter out zero-value entries and sort by value descending
                                    const nonZero = payload.filter(e => (e.value as number) > 0).sort((a, b) => (b.value as number) - (a.value as number));
                                    const dateLabelList = typeof label === 'string' ? dateLabels[label] : undefined;

                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[180px]">
                                            <p className="font-semibold text-gray-900 mb-2">{formattedLabel}</p>
                                            {dateLabelList && dateLabelList.length > 0 && dateLabelList.map((dl) => (
                                                <p key={dl.id} className="text-xs font-medium text-amber-600 mb-1 flex items-center gap-1">
                                                    <span>&#9873;</span> {dl.label}
                                                </p>
                                            ))}
                                            {nonZero.map((entry, index) => {
                                                const value = entry.value as number;
                                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';

                                                return (
                                                    <div key={index} className="flex items-center justify-between gap-4 mb-1">
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className="w-2 h-2 rounded-full"
                                                                style={{ backgroundColor: entry.color }}
                                                            />
                                                            <span className="text-sm font-medium text-gray-700">
                                                                {entry.name}
                                                            </span>
                                                        </div>
                                                        <span className="text-sm font-bold text-gray-700">
                                                            {value} ({percentage}%)
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                            {nonZero.length > 0 && (
                                                <div className="border-t border-gray-100 mt-1 pt-1 flex items-center justify-between">
                                                    <span className="text-sm font-medium text-gray-500">Total</span>
                                                    <span className="text-sm font-bold text-gray-900">{total}</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                }
                                return null;
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
                        {sources.map((source, i) => (
                            <Bar
                                key={source}
                                dataKey={source}
                                name={source}
                                stackId="referral"
                                fill={getSourceColor(source)}
                                radius={i === sources.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
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

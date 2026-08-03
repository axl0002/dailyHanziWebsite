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
    trial3d: number;
    trial7d: number;
    total: number;
};

type SupabaseRow = {
    product_id: string | null;
    event_timestamp: string;
    raw: {
        expiration_at_ms?: number;
        purchased_at_ms?: number;
    } | null;
};

type Props = {
    dateLabels: Record<string, DateLabel[]>;
    onAddLabel: (date: string, label: string) => Promise<void>;
    onDeleteLabel: (id: string) => Promise<void>;
};

function formatDateLabel(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
}

function trialLengthDays(row: SupabaseRow): 3 | 7 | null {
    const pid = row.product_id || '';
    if (pid.endsWith('_3d')) return 3;
    if (pid.endsWith('_7d')) return 7;
    const ets = row.raw?.expiration_at_ms;
    const pts = row.raw?.purchased_at_ms;
    if (ets && pts) {
        const days = (ets - pts) / 86400000;
        if (Math.abs(days - 3) < 0.1) return 3;
        if (Math.abs(days - 7) < 0.1) return 7;
    }
    return null;
}

export default function CancellationByDayChart({ dateLabels, onAddLabel, onDeleteLabel }: Props) {
    const [data, setData] = useState<ChartData[]>([]);
    const [loading, setLoading] = useState(true);
    const [debugInfo, setDebugInfo] = useState({ fetched: 0, displayed: 0, totalInPeriod: 0 });
    const [days, setDays] = useState<14 | 30 | 60 | 90>(14);
    const [pageOffset, setPageOffset] = useState(0);
    const [earliestDate, setEarliestDate] = useState<string | null>(null);
    const [labelModal, setLabelModal] = useState<{ date: string; position: { x: number; y: number } } | null>(null);

    // Fetch earliest trial cancellation date once on mount
    useEffect(() => {
        const fetchEarliest = async () => {
            const { data } = await supabase
                .from('subscription_events')
                .select('event_timestamp')
                .eq('event_type', 'CANCELLATION')
                .eq('period_type', 'TRIAL')
                .eq('cancel_reason', 'UNSUBSCRIBE')
                .order('event_timestamp', { ascending: true })
                .limit(1);
            if (data && data.length > 0) {
                setEarliestDate(data[0].event_timestamp.split('T')[0]);
            }
        };
        fetchEarliest();
    }, []);

    // Compute the date window based on days + pageOffset
    const getDateWindow = useCallback(() => {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - pageOffset * days);
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0, 0, 0, 0);

        return { startDate, endDate };
    }, [days, pageOffset]);

    // Check if we can go further back
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

            // Pad ±1 day to cover the local/UTC date-bucketing boundary.
            const queryStart = new Date(startDate);
            queryStart.setDate(queryStart.getDate() - 1);
            const queryEnd = new Date(endDate);
            queryEnd.setDate(queryEnd.getDate() + 1);

            let allRows: SupabaseRow[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;

                const { data: batch, error } = await supabase
                    .from('subscription_events')
                    .select('product_id, event_timestamp, raw')
                    .eq('event_type', 'CANCELLATION')
                    .eq('period_type', 'TRIAL')
                    .eq('cancel_reason', 'UNSUBSCRIBE')
                    .gte('event_timestamp', queryStart.toISOString())
                    .lte('event_timestamp', queryEnd.toISOString())
                    .order('event_timestamp', { ascending: true })
                    .range(from, to);

                if (error) {
                    console.error('Error fetching cancellations:', error);
                    setLoading(false);
                    return;
                }

                if (batch && batch.length > 0) {
                    allRows = [...allRows, ...(batch as SupabaseRow[])];
                    if (batch.length < pageSize) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }

                page++;

                if (allRows.length > 50000) {
                    console.warn('Reached safety limit of 50k cancellations');
                    hasMore = false;
                }
            }

            const dailyStats: Record<string, { trial3d: number; trial7d: number }> = {};

            for (let i = 0; i < days; i++) {
                const d = new Date(endDate);
                d.setDate(d.getDate() - i);
                const dateString = d.toISOString().split('T')[0];
                dailyStats[dateString] = { trial3d: 0, trial7d: 0 };
            }

            let inPeriodCount = 0;

            allRows.forEach((row) => {
                if (!row.event_timestamp) return;
                const dateString = new Date(row.event_timestamp).toISOString().split('T')[0];
                if (!dailyStats[dateString]) return;
                const len = trialLengthDays(row);
                if (len === 3) {
                    dailyStats[dateString].trial3d++;
                    inPeriodCount++;
                } else if (len === 7) {
                    dailyStats[dateString].trial7d++;
                    inPeriodCount++;
                }
            });

            const chartData = Object.entries(dailyStats)
                .map(([date, stats]) => ({
                    date,
                    trial3d: stats.trial3d,
                    trial7d: stats.trial7d,
                    total: stats.trial3d + stats.trial7d,
                }))
                .sort((a, b) => a.date.localeCompare(b.date));

            setData(chartData);
            setDebugInfo({
                fetched: allRows.length,
                displayed: chartData.length,
                totalInPeriod: inPeriodCount,
            });
            setLoading(false);
        };

        fetchData();
    }, [days, pageOffset, getDateWindow]);

    const { startDate, endDate } = getDateWindow();
    const startLabel = formatDateLabel(startDate.toISOString().split('T')[0]);
    const endLabel = formatDateLabel(endDate.toISOString().split('T')[0]);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    const showSevenDayLine = data.some(d => d.date === sevenDaysAgoStr);

    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];
    const showThreeDayLine = data.some(d => d.date === threeDaysAgoStr);

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
                <h3 className="text-lg font-bold text-gray-900">User Cancellations</h3>
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
                    <h3 className="text-lg font-bold text-gray-900">User Cancellations</h3>
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
                        {debugInfo.totalInPeriod} trial cancellations in period ({debugInfo.fetched} total scanned)
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

                                    const dateLabelList = typeof label === 'string' ? dateLabels[label] : undefined;

                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{formattedLabel}</p>
                                            {dateLabelList && dateLabelList.length > 0 && dateLabelList.map((dl) => (
                                                <p key={dl.id} className="text-xs font-medium text-amber-600 mb-1 flex items-center gap-1">
                                                    <span>&#9873;</span> {dl.label}
                                                </p>
                                            ))}
                                            {payload.map((entry, index) => {
                                                const is7d = entry.name === '7-day trial';
                                                const colorClass = is7d ? 'text-indigo-600' : 'text-purple-500';
                                                const value = entry.value as number;
                                                const total = (entry.payload as { total: number }).total;
                                                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';

                                                return (
                                                    <div key={index} className="flex items-center justify-between gap-4 mb-1">
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className="w-2 h-2 rounded-full"
                                                                style={{ backgroundColor: entry.color }}
                                                            />
                                                            <span className={`text-sm font-medium ${colorClass}`}>
                                                                {entry.name}
                                                            </span>
                                                        </div>
                                                        <span className={`text-sm font-bold ${colorClass}`}>
                                                            {value} ({percentage}%)
                                                        </span>
                                                    </div>
                                                );
                                            })}
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
                        {showThreeDayLine && (
                            <ReferenceLine
                                x={threeDaysAgoStr}
                                stroke="#9CA3AF"
                                strokeDasharray="4 4"
                                label={{ value: '3d ago', position: 'top', fill: '#9CA3AF', fontSize: 11 }}
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
                        <Bar dataKey="trial7d" name="7-day trial" stackId="cancels" fill="#6366F1" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="trial3d" name="3-day trial" stackId="cancels" fill="#C4B5FD" radius={[4, 4, 0, 0]} />
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

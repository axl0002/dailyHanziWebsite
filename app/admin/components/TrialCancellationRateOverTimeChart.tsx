"use client";

import { useEffect, useMemo, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { supabase } from '@/lib/supabase';
import DateLabelModal from './DateLabelModal';
import ClickableXAxisTick from './ClickableXAxisTick';
import StackedReferenceLabel, { assignLabelRows, topMarginForLabelRows } from './StackedReferenceLabel';
import { DateLabel } from './useDateLabels';

type DayStats = {
    date: string;
    starts3d: number;
    starts7d: number;
    cancels3d: number;
    cancels7d: number;
    rate3d: number | null;
    rate7d: number | null;
};

type SupabaseRow = {
    product_id: string | null;
    event_timestamp: string;
    raw: {
        event_timestamp_ms?: number;
        purchased_at_ms?: number;
        expiration_at_ms?: number;
    } | null;
};

type Props = {
    dateLabels: Record<string, DateLabel[]>;
    onAddLabel: (date: string, label: string) => Promise<void>;
    onDeleteLabel: (id: string) => Promise<void>;
    // Window end: 3-day trials + 0d late-cancel buffer past this point
    // are considered resolved. Line for 3-day trials extends this far.
    endBufferDays?: number;
    // Days past which 7-day trials are considered fully resolved.
    // The 7-day line is dropped (null) for days newer than this.
    resolvedBufferDays?: number;
};

type ThresholdMin = 5 | 30 | 60 | 360 | 1440 | null; // null = full trial

const THRESHOLDS: { key: string; value: ThresholdMin; label: string }[] = [
    { key: 'all', value: null, label: 'Full trial' },
    { key: '5m', value: 5, label: '≤ 5m' },
    { key: '30m', value: 30, label: '≤ 30m' },
    { key: '1h', value: 60, label: '≤ 1h' },
    { key: '6h', value: 360, label: '≤ 6h' },
    { key: '24h', value: 1440, label: '≤ 24h' },
];

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

function formatDateLabel(dateStr: string): string {
    const [year, month, day] = dateStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
}

function dateKey(ms: number): string {
    return new Date(ms).toISOString().split('T')[0];
}

export default function TrialCancellationRateOverTimeChart({ dateLabels, onAddLabel, onDeleteLabel, endBufferDays = 3, resolvedBufferDays = 8 }: Props) {
    const [startRows, setStartRows] = useState<SupabaseRow[]>([]);
    const [cancelRows, setCancelRows] = useState<SupabaseRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState<14 | 30 | 60 | 90>(30);
    const [pageOffset, setPageOffset] = useState(0);
    const [threshold, setThreshold] = useState<ThresholdMin>(null);
    const [labelModal, setLabelModal] = useState<{ date: string; position: { x: number; y: number } } | null>(null);

    // Cohort window ends `endBufferDays` before now — far enough that 3-day
    // trials starting on the end date are resolved. The 7-day line is masked
    // for days newer than `resolvedBufferDays` ago (see below).
    const getDateWindow = useCallback(() => {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - endBufferDays - pageOffset * days);
        endDate.setHours(23, 59, 59, 999);

        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0, 0, 0, 0);

        return { startDate, endDate };
    }, [days, pageOffset, endBufferDays]);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const { startDate, endDate } = getDateWindow();

            // Cancellations can arrive up to 7 days after trial start, so extend the fetch window
            // for cancellations to cover trials starting anywhere in [startDate, endDate].
            const cancelFetchEnd = new Date(endDate);
            cancelFetchEnd.setDate(cancelFetchEnd.getDate() + 8);

            const fetchAll = async (
                eventType: string,
                gteISO: string,
                ltISO: string,
                cancelReason?: string,
            ) => {
                const out: SupabaseRow[] = [];
                let page = 0;
                const pageSize = 1000;
                let hasMore = true;
                while (hasMore) {
                    const from = page * pageSize;
                    const to = from + pageSize - 1;
                    let q = supabase
                        .from('subscription_events')
                        .select('product_id, event_timestamp, raw')
                        .eq('event_type', eventType)
                        .eq('period_type', 'TRIAL')
                        .gte('event_timestamp', gteISO)
                        .lt('event_timestamp', ltISO)
                        .order('event_timestamp', { ascending: false })
                        .range(from, to);
                    if (cancelReason) q = q.eq('cancel_reason', cancelReason);
                    const { data: batch, error } = await q;
                    if (error) { console.error('TrialCancellationRateOverTimeChart fetch error:', error); return null; }
                    if (batch && batch.length > 0) {
                        out.push(...(batch as SupabaseRow[]));
                        if (batch.length < pageSize) hasMore = false;
                    } else {
                        hasMore = false;
                    }
                    page++;
                    if (out.length > 50000) hasMore = false;
                }
                return out;
            };

            const [starts, cancels] = await Promise.all([
                fetchAll('INITIAL_PURCHASE', startDate.toISOString(), new Date(endDate.getTime() + 1).toISOString()),
                fetchAll('CANCELLATION', startDate.toISOString(), cancelFetchEnd.toISOString(), 'UNSUBSCRIBE'),
            ]);
            if (!starts || !cancels) { setLoading(false); return; }

            setStartRows(starts);
            setCancelRows(cancels);
            setLoading(false);
        };
        fetchData();
    }, [days, pageOffset, getDateWindow]);

    const data: DayStats[] = useMemo(() => {
        const { startDate, endDate } = getDateWindow();
        const dailyStats: Record<string, DayStats> = {};
        for (let i = 0; i < days; i++) {
            const d = new Date(endDate);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().split('T')[0];
            dailyStats[key] = { date: key, starts3d: 0, starts7d: 0, cancels3d: 0, cancels7d: 0, rate3d: null, rate7d: null };
        }

        for (const r of startRows) {
            const len = trialLengthDays(r);
            if (!len) continue;
            const pts = r.raw?.purchased_at_ms;
            const key = pts ? dateKey(pts) : r.event_timestamp.split('T')[0];
            if (!dailyStats[key]) continue;
            if (len === 3) dailyStats[key].starts3d++;
            else dailyStats[key].starts7d++;
        }

        const windowStartMs = startDate.getTime();
        const windowEndMs = endDate.getTime();
        const thresholdMs = threshold !== null ? threshold * 60000 : null;
        for (const r of cancelRows) {
            const len = trialLengthDays(r);
            const pts = r.raw?.purchased_at_ms;
            const ets = r.raw?.event_timestamp_ms;
            if (!len || !pts) continue;
            if (pts < windowStartMs || pts > windowEndMs) continue;
            if (thresholdMs !== null) {
                if (!ets) continue;
                if (ets - pts > thresholdMs) continue;
            }
            const key = dateKey(pts);
            if (!dailyStats[key]) continue;
            if (len === 3) dailyStats[key].cancels3d++;
            else dailyStats[key].cancels7d++;
        }

        // 7-day trial line is only meaningful once trials starting on that
        // day have had a full 7 days (plus late-cancel buffer) to resolve.
        const resolvedCutoff = new Date();
        resolvedCutoff.setDate(resolvedCutoff.getDate() - resolvedBufferDays);
        const resolvedCutoffKey = resolvedCutoff.toISOString().split('T')[0];

        return Object.values(dailyStats)
            .map((d) => ({
                ...d,
                rate3d: d.starts3d > 0 ? Math.round((d.cancels3d / d.starts3d) * 1000) / 10 : null,
                rate7d: d.date <= resolvedCutoffKey && d.starts7d > 0
                    ? Math.round((d.cancels7d / d.starts7d) * 1000) / 10
                    : null,
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [startRows, cancelRows, threshold, days, getDateWindow, resolvedBufferDays]);

    const { startDate, endDate } = getDateWindow();
    const startLabel = formatDateLabel(startDate.toISOString().split('T')[0]);
    const endLabel = formatDateLabel(endDate.toISOString().split('T')[0]);

    // Recompute the resolved cutoff here to exclude unresolved 7-day cohorts
    // from the 7-day window average (they'd drag it down artificially).
    const resolvedCutoffKey = (() => {
        const d = new Date();
        d.setDate(d.getDate() - resolvedBufferDays);
        return d.toISOString().split('T')[0];
    })();
    const totals = data.reduce(
        (acc, d) => ({
            starts3d: acc.starts3d + d.starts3d,
            starts7d: acc.starts7d + (d.date <= resolvedCutoffKey ? d.starts7d : 0),
            cancels3d: acc.cancels3d + d.cancels3d,
            cancels7d: acc.cancels7d + (d.date <= resolvedCutoffKey ? d.cancels7d : 0),
        }),
        { starts3d: 0, starts7d: 0, cancels3d: 0, cancels7d: 0 },
    );
    const avg3d = totals.starts3d > 0 ? (totals.cancels3d / totals.starts3d) * 100 : null;
    const avg7d = totals.starts7d > 0 ? (totals.cancels7d / totals.starts7d) * 100 : null;

    const rawLabels = data
        .filter(d => dateLabels[d.date]?.length > 0)
        .map(d => ({ date: d.date, labels: dateLabels[d.date].map(dl => dl.label) }));
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
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px] col-span-1 md:col-span-2">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Trial Cancellation Rate Over Time</h3>
            <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-400">Loading chart data...</span>
            </div>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-1 md:col-span-2">
            <div className="flex flex-wrap justify-between items-start mb-6 gap-3">
                <div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-bold text-gray-900">Trial Cancellation Rate Over Time</h3>
                        <span className="text-sm text-gray-500">{startLabel} – {endLabel}</span>
                    </div>
                    <div className="text-xs text-gray-400 leading-snug mt-2">
                        <div>
                            3-day line runs through {endBufferDays}d ago; 7-day line stops at {resolvedBufferDays}d ago (last fully resolved cohort).{' '}
                            {threshold === null
                                ? 'Rate = any cancel ÷ trial starts on that day.'
                                : `Rate = cancels within ${THRESHOLDS.find(t => t.value === threshold)?.label.replace('≤ ', '')} of trial start ÷ trial starts on that day.`}
                        </div>
                        <div>
                            <span className="text-indigo-600 font-medium">
                                Window avg 7-day: {avg7d !== null ? `${avg7d.toFixed(1)}%` : '—'}
                            </span>
                            {' · '}
                            <span className="text-purple-500 font-medium">
                                3-day: {avg3d !== null ? `${avg3d.toFixed(1)}%` : '—'}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex flex-wrap">
                        {THRESHOLDS.map((t) => (
                            <button
                                key={t.key}
                                onClick={() => setThreshold(t.value)}
                                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${threshold === t.value ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => setPageOffset(prev => prev + 1)}
                        className="p-1.5 rounded-md border transition-colors text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900"
                        title="Previous period"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                        <button onClick={() => { setDays(14); setPageOffset(0); }} className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 14 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>14d</button>
                        <button onClick={() => { setDays(30); setPageOffset(0); }} className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 30 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>30d</button>
                        <button onClick={() => { setDays(60); setPageOffset(0); }} className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 60 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>60d</button>
                        <button onClick={() => { setDays(90); setPageOffset(0); }} className={`px-3 py-1 text-xs font-medium rounded transition-colors ${days === 90 ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>90d</button>
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
                </div>
            </div>
            <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: chartTopMargin, right: 30, left: 20, bottom: 5 }}>
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
                            tickFormatter={(v: number) => `${v}%`}
                        />
                        <Tooltip
                            cursor={{ stroke: '#E5E7EB', strokeWidth: 1 }}
                            content={({ active, payload, label }) => {
                                if (!active || !payload || !payload.length) return null;
                                const row = payload[0].payload as DayStats;
                                let formattedLabel = label;
                                if (typeof label === 'string') {
                                    const p = label.split('-');
                                    if (p.length === 3) formattedLabel = `${p[1]}/${p[2]}/${p[0]}`;
                                }
                                const dateLabelList = typeof label === 'string' ? dateLabels[label] : undefined;
                                return (
                                    <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[210px]">
                                        <p className="font-semibold text-gray-900 mb-2">{formattedLabel}</p>
                                        {dateLabelList && dateLabelList.length > 0 && dateLabelList.map((dl) => (
                                            <p key={dl.id} className="text-xs font-medium text-amber-600 mb-1 flex items-center gap-1">
                                                <span>&#9873;</span> {dl.label}
                                            </p>
                                        ))}
                                        <div className="flex items-center justify-between gap-4 mb-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-indigo-500" />
                                                <span className="text-sm font-medium text-indigo-600">7-day trial</span>
                                            </div>
                                            <span className="text-sm font-bold text-indigo-600">
                                                {row.rate7d !== null
                                                    ? `${row.rate7d.toFixed(1)}%`
                                                    : (typeof label === 'string' && label > resolvedCutoffKey ? 'unresolved' : '—')}
                                                <span className="text-xs font-normal text-gray-500 ml-1">({row.cancels7d}/{row.starts7d})</span>
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-purple-400" />
                                                <span className="text-sm font-medium text-purple-500">3-day trial</span>
                                            </div>
                                            <span className="text-sm font-bold text-purple-500">
                                                {row.rate3d !== null ? `${row.rate3d.toFixed(1)}%` : '—'}
                                                <span className="text-xs font-normal text-gray-500 ml-1">({row.cancels3d}/{row.starts3d})</span>
                                            </span>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
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
                        <Line
                            type="monotone"
                            dataKey="rate7d"
                            name="7-day trial"
                            stroke="#6366F1"
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#6366F1', strokeWidth: 0 }}
                            activeDot={{ r: 5, fill: '#6366F1', strokeWidth: 2, stroke: '#fff' }}
                            connectNulls
                        />
                        <Line
                            type="monotone"
                            dataKey="rate3d"
                            name="3-day trial"
                            stroke="#C4B5FD"
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#C4B5FD', strokeWidth: 0 }}
                            activeDot={{ r: 5, fill: '#C4B5FD', strokeWidth: 2, stroke: '#fff' }}
                            connectNulls
                        />
                    </LineChart>
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

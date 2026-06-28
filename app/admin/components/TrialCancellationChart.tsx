"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

type ChartData = {
    bucketKey: string;
    label: string;
    fullLabel: string;
    trial3d: number;
    trial7d: number;
    total: number;
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
    cohortDays?: number;        // size of the cohort window (default 30)
    bufferDays?: number;        // min trial age to be considered fully resolved (default 8)
};

const BUCKET_HOURS = 6;
const MAX_DAYS = 7;
const NUM_BUCKETS = (MAX_DAYS * 24) / BUCKET_HOURS; // 28

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

function fmtDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TrialCancellationChart({ cohortDays = 30, bufferDays = 8 }: Props) {
    const [data, setData] = useState<ChartData[]>([]);
    const [loading, setLoading] = useState(true);
    const [cancels3d, setCancels3d] = useState(0);
    const [cancels7d, setCancels7d] = useState(0);
    const [starts3d, setStarts3d] = useState(0);
    const [starts7d, setStarts7d] = useState(0);
    const [cohortRange, setCohortRange] = useState<{ start: Date; end: Date } | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // Cohort: trials started between (now - cohortDays - bufferDays) and (now - bufferDays).
            // All trials in this range are at least bufferDays old, so 3d and 7d trials have fully resolved.
            const now = Date.now();
            const cohortEnd = new Date(now - bufferDays * 86400000);
            const cohortStart = new Date(now - (cohortDays + bufferDays) * 86400000);
            const cohortStartMs = cohortStart.getTime();
            const cohortEndMs = cohortEnd.getTime();

            // Paginated fetch helper.
            const fetchAll = async (
                eventType: string,
                gteCol: 'event_timestamp',
                gteISO: string,
                ltCol: 'event_timestamp' | null,
                ltISO: string | null,
                extraEq?: { cancel_reason?: string },
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
                        .gte(gteCol, gteISO)
                        .order('event_timestamp', { ascending: false })
                        .range(from, to);
                    if (ltCol && ltISO) q = q.lt(ltCol, ltISO);
                    if (extraEq?.cancel_reason) q = q.eq('cancel_reason', extraEq.cancel_reason);
                    const { data: batch, error } = await q;
                    if (error) { console.error('TrialCancellationChart fetch error:', error); return null; }
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

            // Trial starts: INITIAL_PURCHASE TRIAL events whose event_timestamp falls in the cohort window.
            // Cancellations: CANCELLATION TRIAL UNSUBSCRIBE events from cohort onwards — filter client-side
            // by raw.purchased_at_ms (the original trial start) to match the cohort.
            const [startRows, cancelRows] = await Promise.all([
                fetchAll('INITIAL_PURCHASE', 'event_timestamp', cohortStart.toISOString(), 'event_timestamp', cohortEnd.toISOString()),
                fetchAll('CANCELLATION', 'event_timestamp', cohortStart.toISOString(), null, null, { cancel_reason: 'UNSUBSCRIBE' }),
            ]);
            if (!startRows || !cancelRows) { setLoading(false); return; }

            let s3 = 0, s7 = 0;
            for (const r of startRows) {
                const len = trialLengthDays(r);
                if (len === 3) s3++;
                else if (len === 7) s7++;
            }

            const buckets: ChartData[] = Array.from({ length: NUM_BUCKETS }, (_, i) => {
                const startH = i * BUCKET_HOURS;
                const endH = startH + BUCKET_HOURS;
                const dayStart = startH / 24;
                return {
                    bucketKey: `h${startH}`,
                    label: startH % 24 === 0 ? `D${dayStart}` : '',
                    fullLabel: `Day ${Math.floor(dayStart)} — ${startH}h to ${endH}h after trial start`,
                    trial3d: 0,
                    trial7d: 0,
                    total: 0,
                };
            });

            let c3 = 0, c7 = 0;
            for (const r of cancelRows) {
                const len = trialLengthDays(r);
                const ets = r.raw?.event_timestamp_ms;
                const pts = r.raw?.purchased_at_ms;
                if (!len || !ets || !pts) continue;
                // Filter to cohort: trial start must fall in the cohort window.
                if (pts < cohortStartMs || pts >= cohortEndMs) continue;
                const elapsedHours = (ets - pts) / 3600000;
                if (elapsedHours < 0 || elapsedHours >= MAX_DAYS * 24) continue;
                const idx = Math.min(NUM_BUCKETS - 1, Math.floor(elapsedHours / BUCKET_HOURS));
                if (len === 3) { buckets[idx].trial3d++; c3++; }
                else { buckets[idx].trial7d++; c7++; }
                buckets[idx].total++;
            }

            setData(buckets);
            setCancels3d(c3);
            setCancels7d(c7);
            setStarts3d(s3);
            setStarts7d(s7);
            setCohortRange({ start: cohortStart, end: cohortEnd });
            setLoading(false);
        };
        fetchData();
    }, [cohortDays, bufferDays]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px] col-span-1 md:col-span-2">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Trial Cancellation Timing</h3>
            <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-400">Loading chart data...</span>
            </div>
        </div>
    );

    const labelByKey: Record<string, string> = {};
    data.forEach((d) => { labelByKey[d.bucketKey] = d.label; });
    const totalCancels = cancels3d + cancels7d;
    const cohortLabel = cohortRange
        ? `Cohort: trials started ${fmtDate(cohortRange.start)} – ${fmtDate(cohortRange.end)} (fully resolved)`
        : '';

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-1 md:col-span-2">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-gray-900">Trial Cancellation Timing</h3>
                    <span className="text-sm text-gray-500">{cohortLabel}</span>
                </div>
                <div className="text-right text-xs text-gray-400 leading-snug">
                    <div>{totalCancels} cancellations in cohort</div>
                    <div>
                        <span className="text-indigo-600 font-medium">
                            {starts7d > 0 ? `${((cancels7d / starts7d) * 100).toFixed(1)}%` : '—'}
                        </span>
                        {' '}of {starts7d} 7-day trials
                    </div>
                    <div>
                        <span className="text-purple-500 font-medium">
                            {starts3d > 0 ? `${((cancels3d / starts3d) * 100).toFixed(1)}%` : '—'}
                        </span>
                        {' '}of {starts3d} 3-day trials
                    </div>
                </div>
            </div>
            <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={data}
                        margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            dataKey="bucketKey"
                            tickFormatter={(v: string) => labelByKey[v] ?? ''}
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            interval={3}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const row = payload[0].payload as ChartData;
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[200px]">
                                            <p className="font-semibold text-gray-900 mb-2">{row.fullLabel}</p>
                                            {payload.map((entry, index) => {
                                                const is7d = entry.name === '7-day trial';
                                                const colorClass = is7d ? 'text-indigo-600' : 'text-purple-600';
                                                const value = entry.value as number;
                                                const cohortTotal = is7d ? cancels7d : cancels3d;
                                                const percentage = cohortTotal > 0 ? ((value / cohortTotal) * 100).toFixed(1) : '0.0';
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
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar dataKey="trial7d" name="7-day trial" stackId="cancels" fill="#6366F1" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="trial3d" name="3-day trial" stackId="cancels" fill="#C4B5FD" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

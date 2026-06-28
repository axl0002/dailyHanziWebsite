"use client";

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

type ChartData = {
    bucketKey: string;
    label: string;
    fullLabel: string;
    trial3d: number;       // % of that cohort's cancellations
    trial7d: number;
    trial3dCount: number;
    trial7dCount: number;
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
    cohortDays?: number;
    bufferDays?: number;
};

type Mode = 'full' | 'detail6h';

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

function fmtMinutes(min: number): string {
    if (min === 0) return '0m';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
}

type BucketConfig = {
    minutes: number;       // bucket size
    maxMinutes: number;
    numBuckets: number;
    axisInterval: number;  // Recharts interval prop
    shortLabel: (startMin: number) => string;
};

const FULL_CONFIG: BucketConfig = {
    minutes: 6 * 60,
    maxMinutes: 7 * 24 * 60,
    numBuckets: 28,
    axisInterval: 3,           // every 4th tick = every 24h = day boundary
    shortLabel: (startMin) => startMin % (24 * 60) === 0 ? `D${startMin / 60 / 24}` : '',
};

const DETAIL_CONFIG: BucketConfig = {
    minutes: 15,
    maxMinutes: 6 * 60,
    numBuckets: 24,
    axisInterval: 3,           // every 4th tick = every hour
    shortLabel: (startMin) => startMin % 60 === 0 ? `${startMin / 60}h` : '',
};

export default function TrialCancellationChart({ cohortDays = 30, bufferDays = 8 }: Props) {
    const [cancelRows, setCancelRows] = useState<SupabaseRow[]>([]);
    const [starts3d, setStarts3d] = useState(0);
    const [starts7d, setStarts7d] = useState(0);
    const [cohortRange, setCohortRange] = useState<{ start: Date; end: Date } | null>(null);
    const [loading, setLoading] = useState(true);
    const [mode, setMode] = useState<Mode>('full');

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const now = Date.now();
            const cohortEnd = new Date(now - bufferDays * 86400000);
            const cohortStart = new Date(now - (cohortDays + bufferDays) * 86400000);

            const fetchAll = async (
                eventType: string,
                gteISO: string,
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
                        .gte('event_timestamp', gteISO)
                        .order('event_timestamp', { ascending: false })
                        .range(from, to);
                    if (ltISO) q = q.lt('event_timestamp', ltISO);
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

            const [startRows, rawCancels] = await Promise.all([
                fetchAll('INITIAL_PURCHASE', cohortStart.toISOString(), cohortEnd.toISOString()),
                fetchAll('CANCELLATION', cohortStart.toISOString(), null, { cancel_reason: 'UNSUBSCRIBE' }),
            ]);
            if (!startRows || !rawCancels) { setLoading(false); return; }

            // Filter cancellations to those whose underlying trial start falls in the cohort window.
            const cohortStartMs = cohortStart.getTime();
            const cohortEndMs = cohortEnd.getTime();
            const cohortCancels = rawCancels.filter((r) => {
                const pts = r.raw?.purchased_at_ms;
                return pts !== undefined && pts >= cohortStartMs && pts < cohortEndMs;
            });

            let s3 = 0, s7 = 0;
            for (const r of startRows) {
                const len = trialLengthDays(r);
                if (len === 3) s3++;
                else if (len === 7) s7++;
            }

            setCancelRows(cohortCancels);
            setStarts3d(s3);
            setStarts7d(s7);
            setCohortRange({ start: cohortStart, end: cohortEnd });
            setLoading(false);
        };
        fetchData();
    }, [cohortDays, bufferDays]);

    const { data, cancels3d, cancels7d } = useMemo(() => {
        const cfg = mode === 'detail6h' ? DETAIL_CONFIG : FULL_CONFIG;

        const buckets: ChartData[] = Array.from({ length: cfg.numBuckets }, (_, i) => {
            const startMin = i * cfg.minutes;
            const endMin = startMin + cfg.minutes;
            return {
                bucketKey: `b${startMin}`,
                label: cfg.shortLabel(startMin),
                fullLabel: `${fmtMinutes(startMin)} – ${fmtMinutes(endMin)} after trial start`,
                trial3d: 0,
                trial7d: 0,
                trial3dCount: 0,
                trial7dCount: 0,
            };
        });

        let c3 = 0, c7 = 0;
        for (const r of cancelRows) {
            const len = trialLengthDays(r);
            const ets = r.raw?.event_timestamp_ms;
            const pts = r.raw?.purchased_at_ms;
            if (!len || !ets || !pts) continue;
            const elapsedMin = (ets - pts) / 60000;
            // Cohort cancellations whose elapsed time is outside this view's window are skipped
            // for the chart bars but still counted toward c3/c7 for the cohort total.
            if (len === 3) c3++;
            else if (len === 7) c7++;
            if (elapsedMin < 0 || elapsedMin >= cfg.maxMinutes) continue;
            const idx = Math.min(cfg.numBuckets - 1, Math.floor(elapsedMin / cfg.minutes));
            if (len === 3) buckets[idx].trial3dCount++;
            else buckets[idx].trial7dCount++;
        }
        for (const b of buckets) {
            b.trial3d = c3 > 0 ? (b.trial3dCount / c3) * 100 : 0;
            b.trial7d = c7 > 0 ? (b.trial7dCount / c7) * 100 : 0;
        }
        return { data: buckets, cancels3d: c3, cancels7d: c7 };
    }, [cancelRows, mode]);

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
            <div className="flex flex-wrap justify-between items-start mb-6 gap-3">
                <div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-lg font-bold text-gray-900">Trial Cancellation Timing</h3>
                        <span className="text-sm text-gray-500">{cohortLabel}</span>
                    </div>
                    <div className="text-xs text-gray-400 leading-snug mt-2">
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
                <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                    <button
                        onClick={() => setMode('full')}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${mode === 'full' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Full 7 days (6h)
                    </button>
                    <button
                        onClick={() => setMode('detail6h')}
                        className={`px-3 py-1 text-xs font-medium rounded transition-colors ${mode === 'detail6h' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        First 6 hours (15m)
                    </button>
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
                            interval={(mode === 'detail6h' ? DETAIL_CONFIG : FULL_CONFIG).axisInterval}
                        />
                        <YAxis
                            tick={{ fontSize: 12, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => `${v}%`}
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
                                                const pct = entry.value as number;
                                                const count = is7d ? row.trial7dCount : row.trial3dCount;
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
                                                            {pct.toFixed(1)}% ({count})
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
                        <Bar dataKey="trial7d" name="7-day trial" fill="#6366F1" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="trial3d" name="3-day trial" fill="#C4B5FD" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

type ChartRow = {
    hours: number;      // start of 6-hour bucket
    bucket: string;     // tooltip label
    trial3d: number;
    trial7d: number;
};

type SupabaseRow = {
    product_id: string | null;
    raw: {
        event_timestamp_ms?: number;
        purchased_at_ms?: number;
        expiration_at_ms?: number;
    } | null;
};

const BUCKET_HOURS = 6;
const MAX_DAYS = 7;
const NUM_BUCKETS = (MAX_DAYS * 24) / BUCKET_HOURS; // 28

function trialLengthDays(row: SupabaseRow): 3 | 7 | null {
    const pid = row.product_id || '';
    if (pid.endsWith('_3d')) return 3;
    if (pid.endsWith('_7d')) return 7;
    // Some legacy product IDs don't carry the suffix; infer from actual trial duration.
    const ets = row.raw?.expiration_at_ms;
    const pts = row.raw?.purchased_at_ms;
    if (ets && pts) {
        const days = (ets - pts) / 86400000;
        if (Math.abs(days - 3) < 0.1) return 3;
        if (Math.abs(days - 7) < 0.1) return 7;
    }
    return null;
}

type Props = {
    windowDays?: number;
};

export default function TrialCancellationChart({ windowDays = 30 }: Props) {
    const [data, setData] = useState<ChartRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [totals, setTotals] = useState({ trial3d: 0, trial7d: 0, skipped: 0 });

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const since = new Date(Date.now() - windowDays * 86400000).toISOString();

            const rows: SupabaseRow[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;
            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;
                const { data: batch, error } = await supabase
                    .from('subscription_events')
                    .select('product_id, raw')
                    .eq('event_type', 'CANCELLATION')
                    .eq('period_type', 'TRIAL')
                    .eq('cancel_reason', 'UNSUBSCRIBE')
                    .gte('event_timestamp', since)
                    .order('event_timestamp', { ascending: false })
                    .range(from, to);
                if (error) {
                    console.error('TrialCancellationChart fetch error:', error);
                    setLoading(false);
                    return;
                }
                if (batch && batch.length > 0) {
                    rows.push(...(batch as SupabaseRow[]));
                    if (batch.length < pageSize) hasMore = false;
                } else {
                    hasMore = false;
                }
                page++;
                if (rows.length > 50000) hasMore = false;
            }

            const buckets: ChartRow[] = Array.from({ length: NUM_BUCKETS }, (_, i) => ({
                hours: i * BUCKET_HOURS,
                bucket: `${i * BUCKET_HOURS}h-${(i + 1) * BUCKET_HOURS}h`,
                trial3d: 0,
                trial7d: 0,
            }));

            let t3 = 0, t7 = 0, skipped = 0;
            for (const r of rows) {
                const len = trialLengthDays(r);
                const ets = r.raw?.event_timestamp_ms;
                const pts = r.raw?.purchased_at_ms;
                if (!len || !ets || !pts) { skipped++; continue; }
                const elapsedHours = (ets - pts) / 3600000;
                if (elapsedHours < 0 || elapsedHours >= MAX_DAYS * 24) { skipped++; continue; }
                const idx = Math.min(NUM_BUCKETS - 1, Math.floor(elapsedHours / BUCKET_HOURS));
                if (len === 3) { buckets[idx].trial3d++; t3++; }
                else { buckets[idx].trial7d++; t7++; }
            }
            setData(buckets);
            setTotals({ trial3d: t3, trial7d: t7, skipped });
            setLoading(false);
        };
        fetchData();
    }, [windowDays]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px] col-span-1 md:col-span-2">
            <h3 className="text-lg font-bold text-gray-900">Trial Cancellation Timing</h3>
            <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-400">Loading chart data...</span>
            </div>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-1 md:col-span-2">
            <div className="flex flex-wrap justify-between items-start mb-6 gap-3">
                <div>
                    <h3 className="text-lg font-bold text-gray-900">Trial Cancellation Timing</h3>
                    <p className="text-sm text-gray-500 mt-1">
                        When users turn off auto-renew during their trial — 6h buckets, last {windowDays}d
                    </p>
                </div>
                <div className="text-right text-xs text-gray-500">
                    <div><span className="font-medium text-gray-700">3-day trials canceled:</span> {totals.trial3d}</div>
                    <div><span className="font-medium text-gray-700">7-day trials canceled:</span> {totals.trial7d}</div>
                    {totals.skipped > 0 && <div className="text-gray-400">({totals.skipped} skipped — unknown trial length)</div>}
                </div>
            </div>
            <ResponsiveContainer width="100%" height={400}>
                <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis
                        dataKey="hours"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickFormatter={(h: number) => h % 24 === 0 ? `D${h / 24}` : ''}
                        interval={0}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                    <Tooltip
                        labelFormatter={(label) => {
                            const h = Number(label);
                            return `${h}h–${h + BUCKET_HOURS}h after trial start`;
                        }}
                    />
                    <Legend />
                    <Bar dataKey="trial3d" name="3-day trial" stackId="trial" fill="#c084fc" />
                    <Bar dataKey="trial7d" name="7-day trial" stackId="trial" fill="#6366f1" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

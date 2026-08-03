"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

type ChartData = {
    hour: string;      // ISO hour key, used for bucketing
    label: string;     // short axis label
    fullLabel: string; // full label for tooltip
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

const HOURS = 48;

function pad(n: number): string {
    return n.toString().padStart(2, '0');
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

export default function HourlyCancellationChart() {
    const [data, setData] = useState<ChartData[]>([]);
    const [loading, setLoading] = useState(true);
    const [totalInPeriod, setTotalInPeriod] = useState(0);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);

            // Window: the last 48 full hours, ending at the current hour.
            const endHour = new Date();
            endHour.setMinutes(0, 0, 0);
            const startHour = new Date(endHour);
            startHour.setHours(startHour.getHours() - (HOURS - 1));

            // Only fetch cancellations that happened within the window.
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
                    .gte('event_timestamp', startHour.toISOString())
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

            // Initialize 48 hourly buckets.
            const buckets: Record<string, { label: string; fullLabel: string; trial3d: number; trial7d: number }> = {};
            const order: string[] = [];
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            for (let i = 0; i < HOURS; i++) {
                const d = new Date(startHour);
                d.setHours(d.getHours() + i);
                const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
                // Show date only at midnight to keep the axis readable.
                const label = d.getHours() === 0
                    ? `${monthNames[d.getMonth()]} ${d.getDate()}`
                    : `${pad(d.getHours())}:00`;
                const fullLabel = `${monthNames[d.getMonth()]} ${d.getDate()}, ${pad(d.getHours())}:00`;
                buckets[key] = { label, fullLabel, trial3d: 0, trial7d: 0 };
                order.push(key);
            }

            let inPeriodCount = 0;
            allRows.forEach((row) => {
                if (!row.event_timestamp) return;
                const d = new Date(row.event_timestamp);
                d.setMinutes(0, 0, 0);
                const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
                if (!buckets[key]) return;
                const len = trialLengthDays(row);
                if (len === 3) {
                    buckets[key].trial3d++;
                    inPeriodCount++;
                } else if (len === 7) {
                    buckets[key].trial7d++;
                    inPeriodCount++;
                }
            });

            const chartData: ChartData[] = order.map((key) => ({
                hour: key,
                label: buckets[key].label,
                fullLabel: buckets[key].fullLabel,
                trial3d: buckets[key].trial3d,
                trial7d: buckets[key].trial7d,
                total: buckets[key].trial3d + buckets[key].trial7d,
            }));

            setData(chartData);
            setTotalInPeriod(inPeriodCount);
            setLoading(false);
        };

        fetchData();
    }, []);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px] col-span-1 md:col-span-2">
            <h3 className="text-lg font-bold text-gray-900 mb-6">User Cancellations by Hour</h3>
            <div className="flex-1 flex items-center justify-center">
                <span className="text-gray-400">Loading chart data...</span>
            </div>
        </div>
    );

    // Map unique hour keys → friendly axis labels. The axis must key off `hour`
    // (unique) rather than `label` (clock hours repeat across the 48h window), or
    // scaleBand collapses duplicate labels onto the same x position and the bars
    // no longer line up with their ticks/tooltips.
    const labelByHour: Record<string, string> = {};
    data.forEach((d) => { labelByHour[d.hour] = d.label; });

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-1 md:col-span-2">
            <div className="flex flex-wrap justify-between items-center mb-6 gap-3">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-gray-900">User Cancellations by Hour</h3>
                    <span className="text-sm text-gray-500">Last 48 hours</span>
                </div>
                <span className="text-xs text-gray-400">
                    {totalInPeriod} trial cancellations in period
                </span>
            </div>
            <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={data}
                        margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            dataKey="hour"
                            tickFormatter={(v: string) => labelByHour[v] ?? ''}
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
                                    const fullLabel = (payload[0].payload as ChartData).fullLabel;
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{fullLabel}</p>
                                            {payload.map((entry, index) => {
                                                const is7d = entry.name === '7-day trial';
                                                const colorClass = is7d ? 'text-indigo-600' : 'text-purple-500';
                                                const value = entry.value as number;
                                                const total = (entry.payload as ChartData).total;
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
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Bar dataKey="trial7d" name="7-day trial" stackId="cancels" fill="#6366F1" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="trial3d" name="3-day trial" stackId="cancels" fill="#C4B5FD" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

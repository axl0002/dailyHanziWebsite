"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

type ChartData = {
    hour: string;      // ISO hour key, used for bucketing
    label: string;     // short axis label
    fullLabel: string; // full label for tooltip
    pro: number;
    free: number;
    total: number;
};

type Props = {
    filter?: 'all' | 'true' | 'false';
};

const HOURS = 48;

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

export default function HourlyGrowthChart({ filter }: Props) {
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

            // Only fetch profiles created within the window.
            let allProfiles: { created_at: string; is_pro: boolean | null }[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;

                let query = supabase
                    .from('profiles')
                    .select('created_at, is_pro')
                    .eq('is_beta', false)
                    .gte('created_at', startHour.toISOString())
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

            // Initialize 48 hourly buckets.
            const buckets: Record<string, { label: string; fullLabel: string; pro: number; free: number }> = {};
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
                buckets[key] = { label, fullLabel, pro: 0, free: 0 };
                order.push(key);
            }

            let inPeriodCount = 0;
            allProfiles.forEach((profile) => {
                if (!profile.created_at) return;
                const d = new Date(profile.created_at);
                d.setMinutes(0, 0, 0);
                const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
                if (buckets[key]) {
                    if (profile.is_pro) {
                        buckets[key].pro++;
                    } else {
                        buckets[key].free++;
                    }
                    inPeriodCount++;
                }
            });

            const chartData: ChartData[] = order.map((key) => ({
                hour: key,
                label: buckets[key].label,
                fullLabel: buckets[key].fullLabel,
                pro: buckets[key].pro,
                free: buckets[key].free,
                total: buckets[key].pro + buckets[key].free,
            }));

            setData(chartData);
            setTotalInPeriod(inPeriodCount);
            setLoading(false);
        };

        fetchData();
    }, [filter]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col h-[460px] col-span-1 md:col-span-2">
            <h3 className="text-lg font-bold text-gray-900 mb-6">User Growth by Hour</h3>
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
                    <h3 className="text-lg font-bold text-gray-900">User Growth by Hour</h3>
                    <span className="text-sm text-gray-500">Last 48 hours</span>
                </div>
                <span className="text-xs text-gray-400">
                    {totalInPeriod} new users in period
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
                                                const isPro = entry.name === 'Pro Users';
                                                const colorClass = isPro ? 'text-indigo-600' : 'text-gray-700';
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
                        <Bar dataKey="pro" name="Pro Users" stackId="users" fill="#6366F1" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="free" name="Free Users" stackId="users" fill="#CBD5E1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

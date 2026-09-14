"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useProfilesCache, filterProfiles, type ProFilter, type DateRange } from './useProfilesCache';

type ChartRow = {
    name: string;
    pro: number;
    free: number;
    total: number;
};

// How many sentences the user gets pushed per day. Values live in
// profiles.daily_sentence_count — 1, 2, or 3 depending on their in-app choice.
export default function DailySentenceCountChart({ filter, dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { profiles, loading } = useProfilesCache();

    const data: ChartRow[] = useMemo(() => {
        const rows = filterProfiles(profiles, filter, dateRange);
        const buckets: Record<string, { pro: number; free: number }> = {
            '1': { pro: 0, free: 0 },
            '2': { pro: 0, free: 0 },
            '3': { pro: 0, free: 0 },
        };

        for (const r of rows) {
            const key = r.daily_sentence_count == null ? null : String(r.daily_sentence_count);
            if (key && buckets[key]) {
                if (r.is_pro) buckets[key].pro += 1;
                else buckets[key].free += 1;
            }
        }

        return Object.entries(buckets).map(([name, c]) => ({
            name: `${name}/day`,
            pro: c.pro,
            free: c.free,
            total: c.pro + c.free,
        }));
    }, [profiles, filter, dateRange]);

    const poolTotal = useMemo(() => {
        return data.reduce((s, r) => {
            return s + (filter === 'true' ? r.pro : filter === 'false' ? r.free : r.total);
        }, 0);
    }, [data, filter]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    if (data.every(d => d.total === 0)) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">No Daily Sentence Count data available</p>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <h3 className="text-lg font-bold mb-6 text-gray-900">Daily Sentence Count</h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                            {payload.map((entry, index) => {
                                                const isPro = entry.name === 'Pro Users';
                                                const colorClass = isPro ? 'text-indigo-600' : 'text-gray-700';
                                                const value = entry.value as number;
                                                const percentage = poolTotal > 0 ? ((value / poolTotal) * 100).toFixed(1) : '0.0';

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
                        <Bar dataKey="pro" name="Pro Users" stackId="users" fill="#6366F1" radius={[0, 0, 4, 4]} barSize={32} />
                        <Bar dataKey="free" name="Free Users" stackId="users" fill="#CBD5E1" radius={[4, 4, 0, 0]} barSize={32} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

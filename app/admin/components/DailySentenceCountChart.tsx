"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useProfilesCache, filterProfiles, type ProFilter, type DateRange } from './useProfilesCache';

type ChartRow = {
    name: string;
    pro: number;
};

// How many sentences the user gets pushed per day. Values live in
// profiles.daily_sentence_count — 1, 2, or 3. Free users are locked at 1
// with no way to change it, so we only chart Pro users. When the toolbar
// filter is set to Free, we render an empty state instead.
export default function DailySentenceCountChart({ filter, dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { profiles, loading } = useProfilesCache();

    const data: ChartRow[] = useMemo(() => {
        const rows = filterProfiles(profiles, 'true', dateRange); // force Pro
        const buckets: Record<string, number> = { '1': 0, '2': 0, '3': 0 };
        for (const r of rows) {
            const key = r.daily_sentence_count == null ? null : String(r.daily_sentence_count);
            if (key && buckets[key] !== undefined) buckets[key] += 1;
        }
        return Object.entries(buckets).map(([name, pro]) => ({ name: `${name}/day`, pro }));
    }, [profiles, dateRange]);

    const poolTotal = useMemo(() => data.reduce((s, r) => s + r.pro, 0), [data]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    if (filter === 'false') return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">Daily Sentence Count</p>
            <p className="text-xs text-gray-400 mt-1">Pro feature — no data to show for Free users.</p>
        </div>
    );

    if (data.every(d => d.pro === 0)) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">No Daily Sentence Count data available</p>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Daily Sentence Count</h3>
                <p className="text-xs text-gray-500 mt-1">Pro-only setting — Defaults to 3/day.</p>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const value = payload[0].value as number;
                                    const percentage = poolTotal > 0 ? ((value / poolTotal) * 100).toFixed(1) : '0.0';
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                            <div className="flex items-center justify-between gap-4 mb-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6366F1' }} />
                                                    <span className="text-sm font-medium text-indigo-600">Pro Users</span>
                                                </div>
                                                <span className="text-sm font-bold text-indigo-600">{value} ({percentage}%)</span>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Bar dataKey="pro" name="Pro Users" fill="#6366F1" radius={[4, 4, 0, 0]} barSize={32} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

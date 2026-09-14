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

// UI theme the user picked in-app: classic, dark, nature, ink, plus whatever
// gets added later. Read from profiles.theme.
export default function ThemeChart({ filter, dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { profiles, loading } = useProfilesCache();

    const data: ChartRow[] = useMemo(() => {
        const rows = filterProfiles(profiles, filter, dateRange);
        const counts: Record<string, { pro: number; free: number }> = {};

        for (const r of rows) {
            const key = r.theme ?? '(none)';
            if (!counts[key]) counts[key] = { pro: 0, free: 0 };
            if (r.is_pro) counts[key].pro += 1;
            else counts[key].free += 1;
        }

        return Object.entries(counts)
            .map(([name, c]) => ({ name, pro: c.pro, free: c.free, total: c.pro + c.free }))
            .sort((a, b) => b.total - a.total);
    }, [profiles, filter, dateRange]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold mb-6 text-gray-900">Theme</h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl">
                                            <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                            {payload.map((entry, i) => (
                                                <div key={i} className="flex items-center justify-between gap-4">
                                                    <span className="text-sm text-gray-700">{entry.name}</span>
                                                    <span className="text-sm font-bold text-gray-900">{Number(entry.value).toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Bar dataKey="pro" name="Pro Users" stackId="a" fill="#6366F1" radius={[0, 0, 4, 4]} />
                        <Bar dataKey="free" name="Free Users" stackId="a" fill="#CBD5E1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

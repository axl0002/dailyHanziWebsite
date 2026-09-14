"use client";

import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useProfilesCache, filterProfiles, type ProFilter, type DateRange } from './useProfilesCache';

type Slice = { name: string; value: number; color: string };

// profiles.use_traditional: false = simplified (the default), true = traditional.
// Very lopsided in practice (~99% simplified) but useful to track adoption.
export default function TraditionalSimplifiedChart({ filter, dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { profiles, loading } = useProfilesCache();

    const data: Slice[] = useMemo(() => {
        const rows = filterProfiles(profiles, filter, dateRange);
        let simplified = 0;
        let traditional = 0;

        for (const r of rows) {
            if (r.use_traditional) traditional += 1;
            else simplified += 1;
        }

        return [
            { name: 'Simplified', value: simplified, color: '#6366F1' },
            { name: 'Traditional', value: traditional, color: '#F59E0B' },
        ];
    }, [profiles, filter, dateRange]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    const total = data.reduce((s, r) => s + r.value, 0);

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold mb-6 text-gray-900">Simplified vs Traditional</h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e: { name?: string; value?: number }) => `${e.name ?? ''}: ${total > 0 && e.value !== undefined ? ((e.value / total) * 100).toFixed(1) : 0}%`}>
                            {data.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const v = payload[0].value as number;
                                    const p = total > 0 ? ((v / total) * 100).toFixed(1) : '0';
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl">
                                            <p className="font-semibold text-gray-900">{payload[0].name}</p>
                                            <p className="text-sm text-gray-700">{v.toLocaleString()} ({p}%)</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

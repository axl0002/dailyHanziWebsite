"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useProfilesCache, filterProfiles, type ProFilter, type DateRange } from './useProfilesCache';

type ChartData = {
    name: string;
    pro: number;
    free: number;
    total: number;
};

export default function CategoryChart({ filter, dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { profiles, loading } = useProfilesCache();

    const data: ChartData[] = useMemo(() => {
        const rows = filterProfiles(profiles, filter, dateRange);
        const categoryCounts: Record<string, { pro: number; free: number }> = {};

        for (const profile of rows) {
            const categories = profile.selected_categories;

            if (categories) {
                let catArray: string[] = [];

                if (Array.isArray(categories)) {
                    catArray = categories;
                } else if (typeof categories === 'string') {
                    // Handle comma-separated string just in case
                    catArray = (categories as string).split(',').map((s: string) => s.trim());
                }

                catArray.forEach(cat => {
                    if (cat) {
                        const key = cat.trim();
                        if (key) {
                            if (!categoryCounts[key]) {
                                categoryCounts[key] = { pro: 0, free: 0 };
                            }

                            if (profile.is_pro) {
                                categoryCounts[key].pro++;
                            } else {
                                categoryCounts[key].free++;
                            }
                        }
                    }
                });
            }
        }

        // Convert to array and sort by total descending
        return Object.entries(categoryCounts)
            .map(([name, counts]) => ({
                name,
                pro: counts.pro,
                free: counts.free,
                total: counts.pro + counts.free
            }))
            .sort((a, b) => b.total - a.total);
    }, [profiles, filter, dateRange]);

    const poolTotal = useMemo(() => {
        return data.reduce((s, r) => {
            return s + (filter === 'true' ? r.pro : filter === 'false' ? r.free : r.total);
        }, 0);
    }, [data, filter]);

    // ~28px per row + fixed footer for legend/axis. Ensures every y-axis
    // label stays visible with interval={0}. Floor of 300 keeps small
    // filtered results from looking cramped.
    const chartHeight = Math.max(300, data.length * 28 + 60);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    if (data.length === 0) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">No Category data available</p>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Selected Categories</h3>
                <p className="text-xs text-gray-500 mt-1">Users can pick multiple categories — percentages sum to more than 100%.</p>
            </div>
            <div className="w-full" style={{ height: chartHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={data}
                        layout="vertical"
                        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            type="number"
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="name"
                            width={120}
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
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
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Bar dataKey="pro" name="Pro Users" stackId="category" fill="#6366F1" radius={[0, 0, 4, 4]} barSize={24} />
                        <Bar dataKey="free" name="Free Users" stackId="category" fill="#CBD5E1" radius={[4, 4, 0, 0]} barSize={24} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

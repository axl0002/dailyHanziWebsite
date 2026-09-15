"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useProfilesCache, pivotDist, type ProFilter } from './useProfilesCache';
import { ChartLoading, ChartError, ChartEmpty } from './ChartMessage';

type ChartData = { name: string; pro: number; free: number; total: number };

export default function HSKLevelChart({ filter = 'all' }: { filter?: ProFilter; dateRange?: unknown }) {
    const { distributions, loading, error, retry } = useProfilesCache();

    const data: ChartData[] = useMemo(() => {
        const rows = pivotDist(distributions?.hsk_level, {
            keyLabel: (k) => `HSK ${k}`,
        });
        // Sort by HSK number, not by total
        return rows.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }, [distributions]);

    const poolTotal = useMemo(() => {
        return data.reduce((s, r) => s + (filter === 'true' ? r.pro : filter === 'false' ? r.free : r.total), 0);
    }, [data, filter]);

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="HSK Level" error={error} onRetry={retry} />;
    if (data.length === 0) return <ChartEmpty title="No HSK Level data available" />;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <h3 className="text-lg font-bold mb-6 text-gray-900">HSK Level</h3>
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
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                            {payload.map((entry, index) => {
                                                const isPro = entry.name === 'Pro Users';
                                                const colorClass = isPro ? 'text-indigo-600' : 'text-gray-700';
                                                const value = entry.value as number;
                                                const bucketTotal = (entry.payload as { total: number }).total;
                                                const denominator = filter === 'all' ? bucketTotal : poolTotal;
                                                const percentage = denominator > 0 ? ((value / denominator) * 100).toFixed(1) : '0.0';
                                                return (
                                                    <div key={index} className="flex items-center justify-between gap-4 mb-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                            <span className={`text-sm font-medium ${colorClass}`}>{entry.name}</span>
                                                        </div>
                                                        <span className={`text-sm font-bold ${colorClass}`}>{value} ({percentage}%)</span>
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

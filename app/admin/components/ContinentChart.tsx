"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useProfilesCache, type ProFilter } from './useProfilesCache';
import { ChartLoading, ChartError, ChartEmpty } from './ChartMessage';

type ChartData = {
    name: string;
    pro: number;
    free: number;
    total: number;
};

const IANA_CONTINENTS = new Set([
    'Africa',
    'America',
    'Antarctica',
    'Arctic',
    'Asia',
    'Atlantic',
    'Australia',
    'Europe',
    'Indian',
    'Pacific',
]);

function timezoneToContinent(tz: string): string | null {
    const trimmed = tz.trim();
    if (!trimmed) return null;
    const prefix = trimmed.split('/')[0];
    if (IANA_CONTINENTS.has(prefix)) return prefix;
    return 'Other';
}

export default function ContinentChart({ filter = 'all' }: { filter?: ProFilter; dateRange?: unknown }) {
    const { distributions, loading, error, retry } = useProfilesCache();

    const data: ChartData[] = useMemo(() => {
        // We group by *derived* continent, not by raw tz, so bypass pivotDist
        // and reduce over the raw (tz, is_pro, n) rows directly.
        const continentCounts: Record<string, { pro: number; free: number }> = {};
        for (const row of distributions?.timezone ?? []) {
            if (!row.key) continue;
            const continent = timezoneToContinent(row.key);
            if (!continent) continue;
            if (!continentCounts[continent]) {
                continentCounts[continent] = { pro: 0, free: 0 };
            }
            if (row.is_pro === true) continentCounts[continent].pro += row.n;
            else continentCounts[continent].free += row.n;
        }
        return Object.entries(continentCounts)
            .map(([name, counts]) => ({
                name,
                pro: counts.pro,
                free: counts.free,
                total: counts.pro + counts.free,
            }))
            .sort((a, b) => b.total - a.total);
    }, [distributions]);

    const poolTotal = useMemo(() => {
        return data.reduce((s, r) => {
            return s + (filter === 'true' ? r.pro : filter === 'false' ? r.free : r.total);
        }, 0);
    }, [data, filter]);

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="Continent" error={error} onRetry={retry} />;
    if (data.length === 0) return <ChartEmpty title="No Continent data available" />;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <h3 className="text-lg font-bold mb-6 text-gray-900">Continent</h3>
            <div className="h-[300px] w-full">
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
                                                const bucketTotal = (entry.payload as { total: number }).total;
                                                const denominator = filter === 'all' ? bucketTotal : poolTotal;
                                                const percentage = denominator > 0 ? ((value / denominator) * 100).toFixed(1) : '0.0';

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
                        <Bar dataKey="pro" name="Pro Users" stackId="continent" fill="#6366F1" radius={[0, 0, 4, 4]} barSize={24} />
                        <Bar dataKey="free" name="Free Users" stackId="continent" fill="#CBD5E1" radius={[4, 4, 0, 0]} barSize={24} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

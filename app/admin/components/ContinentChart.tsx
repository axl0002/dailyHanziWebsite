"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

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

export default function ContinentChart({ filter }: { filter?: 'all' | 'true' | 'false' }) {
    const [data, setData] = useState<ChartData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            let allProfiles: { timezone: string | null; is_pro: boolean | null }[] = [];
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            while (hasMore) {
                const from = page * pageSize;
                const to = from + pageSize - 1;

                let query = supabase
                    .from('profiles')
                    .select('timezone, is_pro')
                    .eq('is_beta', false)
                    .order('id', { ascending: true })
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
                    hasMore = false;
                }
            }

            const continentCounts: Record<string, { pro: number; free: number }> = {};

            allProfiles.forEach((profile) => {
                if (!profile.timezone) return;
                const continent = timezoneToContinent(profile.timezone);
                if (!continent) return;

                if (!continentCounts[continent]) {
                    continentCounts[continent] = { pro: 0, free: 0 };
                }

                if (profile.is_pro) {
                    continentCounts[continent].pro++;
                } else {
                    continentCounts[continent].free++;
                }
            });

            const chartData = Object.entries(continentCounts)
                .map(([name, counts]) => ({
                    name,
                    pro: counts.pro,
                    free: counts.free,
                    total: counts.pro + counts.free,
                }))
                .sort((a, b) => b.total - a.total);

            setData(chartData);
            setLoading(false);
        };

        fetchData();
    }, [filter]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    if (data.length === 0) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">No Continent data available</p>
            <p className="text-sm text-gray-400 mt-1">User locations will appear here.</p>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <h3 className="text-lg font-bold mb-6 text-gray-900">User Locations (Continent)</h3>
            <div className="h-[400px] w-full">
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
                                                const total = (entry.payload as { total: number }).total;
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
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        <Bar dataKey="pro" name="Pro Users" stackId="continent" fill="#6366F1" radius={[0, 0, 4, 4]} barSize={24} />
                        <Bar dataKey="free" name="Free Users" stackId="continent" fill="#CBD5E1" radius={[4, 4, 0, 0]} barSize={24} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

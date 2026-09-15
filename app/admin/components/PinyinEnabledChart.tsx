"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useProfilesCache, type ProFilter } from './useProfilesCache';
import { ChartLoading, ChartError, ChartEmpty, ChartProOnlyPlaceholder } from './ChartMessage';

type ChartRow = { name: string; pro: number };

// profiles.show_pinyin: whether the user has pinyin annotations turned on.
// The toggle is Pro-gated, so only Pro users can change it — Free users all
// sit on the default. Chart shows Pro users only; toolbar Free hides it.
export default function PinyinEnabledChart({ filter = 'all' }: { filter?: ProFilter; dateRange?: unknown }) {
    const { distributions, loading, error, retry } = useProfilesCache();

    const data: ChartRow[] = useMemo(() => {
        const counts: Record<string, number> = { 'Pinyin on': 0, 'Pinyin off': 0 };
        for (const r of distributions?.show_pinyin ?? []) {
            const key = r.key ? 'Pinyin on' : 'Pinyin off';
            counts[key] += r.n;
        }
        return (['Pinyin on', 'Pinyin off'] as const).map(name => ({ name, pro: counts[name] }));
    }, [distributions]);

    const poolTotal = useMemo(() => data.reduce((s, r) => s + r.pro, 0), [data]);

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="Pinyin Enabled" error={error} onRetry={retry} />;
    if (filter === 'false') return <ChartProOnlyPlaceholder title="Pinyin Enabled" />;
    if (data.every(d => d.pro === 0)) return <ChartEmpty title="No Pinyin Enabled data available" />;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Pinyin Enabled</h3>
                <p className="text-xs text-gray-500 mt-1">Pro-only setting — Free users can&apos;t toggle this.</p>
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

"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useProfilesCache, pivotDist, type ProFilter } from './useProfilesCache';
import { ChartLoading, ChartError, ChartEmpty } from './ChartMessage';

const AGE_ORDER = ['Under 18', '18-24', '25-34', '35-44', '45-54', '55+', 'Not provided'];

export default function AgeChart({ filter = 'all' }: { filter?: ProFilter; dateRange?: unknown }) {
    const { distributions, loading, error, retry } = useProfilesCache();
    const data = useMemo(() => pivotDist(distributions?.age_range)
        .sort((a, b) => {
            const rank = (name: string) => {
                const index = AGE_ORDER.indexOf(name);
                return index < 0 ? AGE_ORDER.length - 1.5 : index;
            };
            return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
        })
        .filter(row => (filter === 'true' ? row.pro : filter === 'false' ? row.free : row.total) > 0),
    [distributions, filter]);
    const total = data.reduce((sum, row) => sum + (filter === 'true' ? row.pro : filter === 'false' ? row.free : row.total), 0);
    const missing = data.find(row => row.name === 'Not provided');
    const missingCount = missing ? (filter === 'true' ? missing.pro : filter === 'false' ? missing.free : missing.total) : 0;

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="Age" error={error} onRetry={retry} />;
    if (data.length === 0) return <ChartEmpty title="No age data available" hint="Age survey responses will appear here." />;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900">Age</h3>
            <p className="text-sm text-gray-500 mt-1 mb-6">
                {total - missingCount} of {total} users provided their age range.
            </p>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={100} interval={0} tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            formatter={(value) => {
                                const count = Number(value);
                                return `${count} (${total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'}%)`;
                            }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} />
                        {filter !== 'false' && <Bar dataKey="pro" name="Pro Users" stackId="age" fill="#6366F1" barSize={24} />}
                        {filter !== 'true' && <Bar dataKey="free" name="Free Users" stackId="age" fill="#CBD5E1" barSize={24} />}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

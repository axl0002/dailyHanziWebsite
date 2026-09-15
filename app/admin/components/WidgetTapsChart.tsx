"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useRpcData, sinceFromDateRange } from './useRpcData';
import { ChartLoading, ChartError, ChartProOnlyPlaceholder } from './ChartMessage';

type DateRange = 'all' | '30d' | '7d';
type ProFilter = 'all' | 'true' | 'false';

type Row = { bucket: string; sort_order: number; pro: number; free: number; total: number };

const parseRow = (r: unknown): Row => {
    const x = r as { bucket: string; sort_order: number; pro: number | string; free: number | string; total: number | string };
    return {
        bucket: x.bucket,
        sort_order: x.sort_order,
        pro: typeof x.pro === 'string' ? parseInt(x.pro, 10) : (x.pro ?? 0),
        free: typeof x.free === 'string' ? parseInt(x.free, 10) : (x.free ?? 0),
        total: typeof x.total === 'string' ? parseInt(x.total, 10) : (x.total ?? 0),
    };
};

// Histogram of Pro users bucketed by widget_tapped count in the window.
// The 0-bucket includes everyone who never taps — the point of the chart
// is to compare "using the feature" vs "not using it".
export default function WidgetTapsChart({ filter = 'all', dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { data, loading, error, retry } = useRpcData(
        'widget_tap_stats',
        { since_date: sinceFromDateRange(dateRange) },
        parseRow,
    );

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="Widget Taps" error={error} onRetry={retry} />;
    if (filter === 'false') return <ChartProOnlyPlaceholder title="Widget Taps" />;

    const poolTotal = data.reduce((s, r) => s + r.pro, 0);
    const tappers = data.filter(r => r.bucket !== '0').reduce((s, r) => s + r.pro, 0);
    const rangeLabel = dateRange === 'all' ? 'all time' : dateRange === '30d' ? 'last 30 days' : 'last 7 days';

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-bold text-gray-900">Widget Taps per User</h3>
                    <span className="text-xs text-gray-500">{tappers.toLocaleString()} of {poolTotal.toLocaleString()} Pro users tapped ≥1 ({rangeLabel})</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Distribution of widget_tapped events per user. The 0 bucket = users who never tap.</p>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const value = payload[0].value as number;
                                    const percentage = poolTotal > 0 ? ((value / poolTotal) * 100).toFixed(1) : '0.0';
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label} taps</p>
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

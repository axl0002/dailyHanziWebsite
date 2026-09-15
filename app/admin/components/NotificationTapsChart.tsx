"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useRpcData, sinceFromDateRange } from './useRpcData';
import { ChartLoading, ChartError, ChartEmpty, ChartProOnlyPlaceholder } from './ChartMessage';

type DateRange = 'all' | '30d' | '7d';
type ProFilter = 'all' | 'true' | 'false';

type Row = { type: string; pro: number; free: number; total: number };

const parseRow = (r: unknown): Row => {
    const x = r as { type: string; pro: number | string; free: number | string; total: number | string };
    return {
        type: x.type,
        pro: typeof x.pro === 'string' ? parseInt(x.pro, 10) : (x.pro ?? 0),
        free: typeof x.free === 'string' ? parseInt(x.free, 10) : (x.free ?? 0),
        total: typeof x.total === 'string' ? parseInt(x.total, 10) : (x.total ?? 0),
    };
};

// Distinct Pro users who tapped ≥1 notification of each type in the window,
// plus a synthetic "None (never tapped)" row for users who tapped no
// notifications at all. Bars for the real types overlap (a user can tap
// multiple types); the None row is disjoint from all of them.
export default function NotificationTapsChart({ filter = 'all', dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { data, loading, error, retry } = useRpcData(
        'notification_tap_stats',
        { since_date: sinceFromDateRange(dateRange) },
        parseRow,
    );

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="Notification Taps" error={error} onRetry={retry} />;
    if (filter === 'false') return <ChartProOnlyPlaceholder title="Notification Taps by Type" />;
    if (data.length === 0) return <ChartEmpty title="No Pro users found" />;

    const rangeLabel = dateRange === 'all' ? 'all time' : dateRange === '30d' ? 'last 30 days' : 'last 7 days';

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Notification Taps by Type ({rangeLabel})</h3>
                <p className="text-xs text-gray-500 mt-1">Distinct Pro users who tapped each type. Type bars overlap (users can tap multiple); the &quot;None&quot; row is disjoint.</p>
            </div>
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
                            dataKey="type"
                            width={160}
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                            interval={0}
                        />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const value = payload[0].value as number;
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                            <div className="flex items-center justify-between gap-4 mb-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#6366F1' }} />
                                                    <span className="text-sm font-medium text-indigo-600">Pro Users</span>
                                                </div>
                                                <span className="text-sm font-bold text-indigo-600">{value.toLocaleString()}</span>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Bar dataKey="pro" name="Pro Users" fill="#6366F1" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';

type DateRange = 'all' | '30d' | '7d';
type ProFilter = 'all' | 'true' | 'false';

type Row = { type: string; pro: number; free: number; total: number };

// Total notification_tapped events grouped by props.type — one bar per push
// notification category so we can see which types drive re-engagement.
// The client isn't emitting these yet; will render an empty state until it does.
export default function NotificationTapsChart({ filter = 'all', dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const [data, setData] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            const since = dateRange === '7d'
                ? new Date(Date.now() - 7 * 86400_000).toISOString()
                : dateRange === '30d'
                    ? new Date(Date.now() - 30 * 86400_000).toISOString()
                    : null;
            const { data: raw, error: rpcErr } = await supabase.rpc('notification_tap_stats', { since_date: since });
            if (rpcErr) {
                console.error('notification_tap_stats:', rpcErr);
                setError(rpcErr.message ?? 'RPC failed');
                setLoading(false);
                return;
            }
            const arr = Array.isArray(raw) ? raw : [];
            const rows: Row[] = (arr as { type: string; pro: number | string; free: number | string; total: number | string }[]).map(r => ({
                type: r.type,
                pro: typeof r.pro === 'string' ? parseInt(r.pro, 10) : (r.pro ?? 0),
                free: typeof r.free === 'string' ? parseInt(r.free, 10) : (r.free ?? 0),
                total: typeof r.total === 'string' ? parseInt(r.total, 10) : (r.total ?? 0),
            }));
            setData(rows);
            setLoading(false);
        };
        fetchData();
    }, [dateRange]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    if (error) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]">
            <p className="text-red-600 font-medium">Failed to load Notification Taps</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
        </div>
    );

    if (filter === 'false') return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">Notification Taps by Type</p>
            <p className="text-xs text-gray-400 mt-1">Pro feature — no data to show for Free users.</p>
        </div>
    );

    if (data.length === 0 || data.every(d => d.pro === 0)) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">No Notification Tap data yet</p>
            <p className="text-xs text-gray-400 mt-1">Waiting on the client to emit notification_tapped events.</p>
        </div>
    );

    const poolTotal = data.reduce((s, r) => s + r.pro, 0);

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Notification Taps by Type</h3>
                <p className="text-xs text-gray-500 mt-1">Total notification_tapped events from Pro users, grouped by props.type.</p>
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
                            width={140}
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
                        <Bar dataKey="pro" name="Pro Users" fill="#6366F1" radius={[0, 4, 4, 0]} barSize={20} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

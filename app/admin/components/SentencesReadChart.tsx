"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';

type DateRange = 'all' | '30d' | '7d';
type ProFilter = 'all' | 'true' | 'false';

type Row = { bucket: string; sort_order: number; pro: number; free: number; total: number };

// Histogram of users bucketed by how many sentences they've marked as read.
// Backed by sentences_read_histogram RPC (SECURITY DEFINER + is_staff gate,
// returns jsonb array). Each bucket now includes pro/free breakdown so we can
// render stacked bars on the client and filter locally.
export default function SentencesReadChart({ filter = 'all', dateRange = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
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

            const { data: raw, error: rpcErr } = await supabase.rpc('sentences_read_histogram', { since_date: since });
            if (rpcErr) {
                console.error('sentences_read_histogram:', rpcErr);
                setError(rpcErr.message ?? 'RPC failed');
                setLoading(false);
                return;
            }
            // RPC returns a single jsonb value (an array). supabase-js unwraps it, so
            // raw should already be the array — but some clients / edge cases wrap it
            // in { data: [...] }, so unwrap defensively.
            const arr = Array.isArray(raw)
                ? raw
                : (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data))
                    ? (raw as { data: unknown[] }).data
                    : [];
            const rows: Row[] = (arr as { bucket: string; sort_order: number; pro: number | string; free: number | string; total: number | string }[]).map(r => ({
                bucket: r.bucket,
                sort_order: r.sort_order,
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
            <p className="text-red-600 font-medium">Failed to load Sentences Read</p>
            <p className="text-xs text-gray-500 mt-1">{error}</p>
        </div>
    );

    if (filter === 'false') return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1 flex flex-col items-center justify-center h-[300px]">
            <p className="text-gray-500 font-medium">Sentences Read per User</p>
            <p className="text-xs text-gray-400 mt-1">Pro feature — no data to show for Free users.</p>
        </div>
    );

    // Pro-only chart: "mark as read" is a Pro feature. Ignore the free bar.
    const poolTotal = data.reduce((s, r) => s + r.pro, 0);
    const activeUsers = data.filter(r => r.bucket !== '0').reduce((s, r) => s + r.pro, 0);
    const rangeLabel = dateRange === 'all' ? 'all time' : dateRange === '30d' ? 'last 30 days' : 'last 7 days';

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <div className="flex items-baseline justify-between">
                    <h3 className="text-lg font-bold text-gray-900">Sentences Read per User</h3>
                    <span className="text-xs text-gray-500">{activeUsers.toLocaleString()} of {poolTotal.toLocaleString()} Pro users read ≥1 ({rangeLabel})</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Pro-only feature — Free users can&apos;t mark sentences as read.</p>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            dataKey="bucket"
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: '#6B7280' }}
                            tickLine={false}
                            axisLine={false}
                        />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const value = payload[0].value as number;
                                    const percentage = poolTotal > 0 ? ((value / poolTotal) * 100).toFixed(1) : '0.0';
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[150px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label} sentences read</p>
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

"use client";

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';

type DateRange = 'all' | '30d' | '7d';

type Row = { bucket: string; sort_order: number; n: number };

// Histogram of users bucketed by how many sentences they've marked as read.
// Backed by sentences_read_histogram RPC (SECURITY DEFINER + is_staff gate,
// returns jsonb array).
export default function SentencesReadChart({ dateRange = 'all' }: { dateRange?: DateRange }) {
    const [data, setData] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const since = dateRange === '7d'
                ? new Date(Date.now() - 7 * 86400_000).toISOString()
                : dateRange === '30d'
                    ? new Date(Date.now() - 30 * 86400_000).toISOString()
                    : null;

            const { data: raw, error } = await supabase.rpc('sentences_read_histogram', { since_date: since });
            if (error) { console.error(error); setLoading(false); return; }
            const rows: Row[] = Array.isArray(raw)
                ? (raw as { bucket: string; sort_order: number; n: number | string }[]).map(r => ({
                    bucket: r.bucket,
                    sort_order: r.sort_order,
                    n: typeof r.n === 'string' ? parseInt(r.n, 10) : r.n,
                }))
                : [];
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

    const totalUsers = data.reduce((s, r) => s + r.n, 0);
    const activeUsers = data.filter(r => r.bucket !== '0').reduce((s, r) => s + r.n, 0);
    const rangeLabel = dateRange === 'all' ? 'all time' : dateRange === '30d' ? 'last 30 days' : 'last 7 days';

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <div className="flex items-baseline justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-900">Sentences Read per User</h3>
                <span className="text-xs text-gray-500">{activeUsers.toLocaleString()} of {totalUsers.toLocaleString()} users read ≥1 ({rangeLabel})</span>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    const v = Number(payload[0].value);
                                    const pct = totalUsers > 0 ? ((v / totalUsers) * 100).toFixed(1) : '0';
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl">
                                            <p className="font-semibold text-gray-900 mb-1">{label} sentences read</p>
                                            <p className="text-sm text-gray-700">{v.toLocaleString()} users ({pct}%)</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Bar dataKey="n" fill="#6366F1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

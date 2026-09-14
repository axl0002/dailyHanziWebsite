"use client";

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabase';

type DateRange = 'all' | '30d' | '7d';

type Row = { day: string; n: number };

// Calls the sentences_read_by_day RPC (SECURITY DEFINER, is_staff-gated) and
// renders a line chart of daily read counts. RPC returns a jsonb array to
// bypass PostgREST's 1000-row cap.
export default function SentencesReadChart({ dateRange = 'all' }: { dateRange?: DateRange }) {
    const [data, setData] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const since = dateRange === '7d'
                ? new Date(Date.now() - 7 * 86400_000).toISOString()
                : dateRange === '30d'
                    ? new Date(Date.now() - 30 * 86400_000).toISOString()
                    : null;

            const { data: raw, error } = await supabase.rpc('sentences_read_by_day', { since_date: since });
            if (error) { console.error(error); setLoading(false); return; }
            const rows: Row[] = Array.isArray(raw)
                ? (raw as { day: string; n: number | string }[]).map(r => ({
                    day: r.day,
                    n: typeof r.n === 'string' ? parseInt(r.n, 10) : r.n,
                }))
                : [];
            setData(rows);
            setTotal(rows.reduce((s, r) => s + r.n, 0));
            setLoading(false);
        };
        fetchData();
    }, [dateRange]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2">
            <div className="flex items-baseline justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-900">Sentences Marked as Read</h3>
                <span className="text-sm text-gray-500">{total.toLocaleString()} total</span>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} minTickGap={20} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl">
                                            <p className="font-semibold text-gray-900 mb-1">{label}</p>
                                            <p className="text-sm text-gray-700">{Number(payload[0].value).toLocaleString()} sentences read</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Line type="monotone" dataKey="n" stroke="#6366F1" strokeWidth={2} dot={false} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

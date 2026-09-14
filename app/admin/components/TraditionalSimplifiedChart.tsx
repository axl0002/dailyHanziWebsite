"use client";

import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';

type DateRange = 'all' | '30d' | '7d';
type Filter = 'all' | 'true' | 'false';

type Slice = { name: string; value: number; color: string };

// profiles.use_traditional: false = simplified (the default), true = traditional.
// Very lopsided in practice (~99% simplified) but useful to track adoption.
export default function TraditionalSimplifiedChart({ filter, dateRange = 'all' }: { filter?: Filter; dateRange?: DateRange }) {
    const [data, setData] = useState<Slice[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            let simplified = 0;
            let traditional = 0;

            let page = 0;
            const pageSize = 1000;
            const cutoff = dateRange === '7d'
                ? new Date(Date.now() - 7 * 86400_000).toISOString()
                : dateRange === '30d'
                    ? new Date(Date.now() - 30 * 86400_000).toISOString()
                    : null;

            while (true) {
                const from = page * pageSize;
                const to = from + pageSize - 1;
                let q = supabase
                    .from('profiles')
                    .select('use_traditional')
                    .eq('is_beta', false)
                    .order('id', { ascending: true })
                    .range(from, to);
                if (filter === 'true') q = q.eq('is_pro', true);
                else if (filter === 'false') q = q.eq('is_pro', false);
                if (cutoff) q = q.gte('created_at', cutoff);

                const { data: batch, error } = await q;
                if (error) { console.error(error); break; }
                if (!batch || batch.length === 0) break;

                for (const r of batch as { use_traditional: boolean | null }[]) {
                    if (r.use_traditional) traditional += 1;
                    else simplified += 1;
                }
                if (batch.length < pageSize) break;
                page++;
                if (page > 500) break;
            }

            setData([
                { name: 'Simplified', value: simplified, color: '#6366F1' },
                { name: 'Traditional', value: traditional, color: '#F59E0B' },
            ]);
            setLoading(false);
        };
        fetchData();
    }, [filter, dateRange]);

    if (loading) return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex items-center justify-center h-[300px]">
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );

    const total = data.reduce((s, r) => s + r.value, 0);

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold mb-6 text-gray-900">Simplified vs Traditional</h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e: { name?: string; value?: number }) => `${e.name ?? ''}: ${total > 0 && e.value !== undefined ? ((e.value / total) * 100).toFixed(1) : 0}%`}>
                            {data.map((entry, i) => (
                                <Cell key={i} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip
                            content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                    const v = payload[0].value as number;
                                    const p = total > 0 ? ((v / total) * 100).toFixed(1) : '0';
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl">
                                            <p className="font-semibold text-gray-900">{payload[0].name}</p>
                                            <p className="text-sm text-gray-700">{v.toLocaleString()} ({p}%)</p>
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

"use client";

import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { summarizePrompts, responseTypes, type PromptStat } from '@/lib/promptAnalytics';
const colors = ['#6366F1', '#059669', '#D97706', '#DB2777'];
function label(type: string) { return type.charAt(0).toUpperCase() + type.slice(1); }

export default function DailyPromptAnalytics({ type, refresh }: { type: string; refresh: number }) {
    const [days, setDays] = useState(30);
    const [rows, setRows] = useState<PromptStat[]>([]);
    const [dates, setDates] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [sort, setSort] = useState<'responded' | 'rate'>('responded');
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError('');
        (async () => {
            try {
                const response = await fetch(`/api/admin/daily-prompts/analytics?days=${days}&type=${encodeURIComponent(type)}`, { cache: 'no-store', signal: controller.signal });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Could not load analytics.');
                if (controller.signal.aborted) return;
                const windowDates: string[] = [];
                for (const day = new Date(`${data.startDate}T00:00:00Z`); day.toISOString().slice(0, 10) <= data.endDate; day.setUTCDate(day.getUTCDate() + 1)) windowDates.push(day.toISOString().slice(0, 10));
                setDates(windowDates); setRows(data.rows);
            } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load analytics.'); }
            finally { if (!controller.signal.aborted) setLoading(false); }
        })();
        return () => controller.abort();
    }, [days, type, refresh, retry]);
    const stats = useMemo(() => summarizePrompts(rows, dates), [rows, dates]);
    const types = responseTypes.filter(value => !type || type === value);
    const ranked = [...stats.prompts].sort((a, b) => b[sort] - a[sort] || b.responded - a.responded || a.slug.localeCompare(b.slug));
    return <section className="space-y-5 border-b border-gray-200 pb-8">
        <div className="flex flex-wrap justify-between gap-3 items-center"><h2 className="text-xl font-bold">Prompt engagement</h2><div className="flex gap-1" aria-label="Analytics date range">{[14, 30, 90].map(value => <button key={value} onClick={() => setDays(value)} aria-pressed={days === value} className={`px-3 py-1.5 rounded-lg text-sm ${days === value ? 'bg-indigo-100 text-indigo-700' : 'bg-white border border-gray-200'}`}>{value}d</button>)}</div></div>
        <p className="text-sm text-gray-500">Response rate = assignments with a currently stored response ÷ all assignments, grouped by the prompt&apos;s date and type. Each assignment counts once. This measures assigned prompts, not views. Deleted responses no longer count; today is still in progress.</p>
        {loading ? <p role="status" className="text-gray-500">Loading engagement…</p> : error ? <p role="alert" className="text-red-700">{error} <button className="underline" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : <>
            <div className="grid grid-cols-3 gap-3">{[['Assigned', stats.assigned.toLocaleString()], ['Responses', stats.responded.toLocaleString()], ['Response rate', stats.rate === null ? '—' : `${stats.rate}%`]].map(([title, value]) => <div key={title} className="bg-white p-4 rounded-xl border border-gray-200"><p className="text-xs text-gray-500">{title}</p><p className="text-2xl font-semibold mt-1">{value}</p></div>)}</div>
            {!stats.assigned ? <p className="text-gray-500">No prompt assignments in this period for the selected type.</p> : <>
                <div className="grid xl:grid-cols-2 gap-5">
                    <div className="bg-white rounded-xl border border-gray-200 p-5"><h3 className="font-semibold mb-4">Daily response rate by type</h3><div className="h-80"><ResponsiveContainer width="100%" height="100%"><LineChart data={stats.daily}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={25} /><YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} />
                        <Tooltip content={({ active, payload, label: date }) => {
                            if (!active || !payload?.length) return null;
                            const day = payload[0].payload as typeof stats.daily[number];
                            return <div className="bg-white border rounded-lg shadow p-3 text-sm"><p className="font-semibold mb-2">{date}</p>{[...types].sort((a, b) => (day.counts[b].rate ?? -1) - (day.counts[a].rate ?? -1)).map(value => <p key={value} style={{ color: colors[responseTypes.indexOf(value)] }}>{label(value)}: {day.counts[value].rate === null ? 'No assignments' : `${day.counts[value].rate}% (${day.counts[value].responded}/${day.counts[value].assigned})`}</p>)}</div>;
                        }} /><Legend />{types.map(value => <Line key={value} name={label(value)} dataKey={day => day.counts[value].rate} stroke={colors[responseTypes.indexOf(value)]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />)}
                    </LineChart></ResponsiveContainer></div></div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5"><h3 className="font-semibold mb-4">Daily responses by type</h3><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={stats.daily}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} minTickGap={25} /><YAxis allowDecimals={false} /><Tooltip /><Legend />{types.map(value => <Bar key={value} name={label(value)} dataKey={day => day.counts[value].responded} stackId="responses" fill={colors[responseTypes.indexOf(value)]} isAnimationActive={false} />)}
                    </BarChart></ResponsiveContainer></div></div>
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-5"><div className="flex flex-wrap justify-between gap-3 items-center mb-3"><h3 className="font-semibold">Which prompts get responses?</h3><label className="text-sm">Rank by <select value={sort} onChange={event => setSort(event.target.value as 'responded' | 'rate')} className="ml-2 border rounded-md p-2"><option value="responded">Most responses</option><option value="rate">Highest response rate</option></select></label></div>
                    <p className="text-xs text-gray-500 mb-4">Compare response rate alongside assignment count: high rates from small samples may be misleading. Totals cover the selected period and type.</p>
                    <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="text-xs text-gray-500 border-b"><tr><th className="py-3 pr-4">Prompt</th><th className="p-3">Type</th><th className="p-3 text-right">Assigned</th><th className="p-3 text-right">Responses</th><th className="p-3 text-right">Rate</th></tr></thead><tbody>{ranked.map(prompt => <tr key={prompt.id} className="border-b last:border-0"><td className="py-3 pr-4"><p className="font-medium">{prompt.title || prompt.slug}</p><p className="text-xs text-gray-500">{prompt.slug}</p></td><td className="p-3">{label(prompt.type)}</td><td className="p-3 text-right">{prompt.assigned}</td><td className="p-3 text-right">{prompt.responded}</td><td className="p-3 text-right font-medium">{prompt.rate}%</td></tr>)}</tbody></table></div>
                </div>
            </>}
        </>}
    </section>;
}

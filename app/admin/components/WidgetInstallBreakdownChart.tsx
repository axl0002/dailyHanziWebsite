"use client";

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useRpcData } from './useRpcData';
import { ChartLoading, ChartError, ChartEmpty, ChartProOnlyPlaceholder } from './ChartMessage';

type DateRange = 'all' | '30d' | '7d';
type ProFilter = 'all' | 'true' | 'false';

type RawRow = { widget: string; surface: string; pro: number; free: number; total: number };

const parseRow = (r: unknown): RawRow => {
    const x = r as { widget: string; surface: string; pro: number | string; free: number | string; total: number | string };
    return {
        widget: x.widget,
        surface: x.surface,
        pro: typeof x.pro === 'string' ? parseInt(x.pro, 10) : (x.pro ?? 0),
        free: typeof x.free === 'string' ? parseInt(x.free, 10) : (x.free ?? 0),
        total: typeof x.total === 'string' ? parseInt(x.total, 10) : (x.total ?? 0),
    };
};

// Palette for surface bars. Ordered so 'home' + 'lock' get the primary /
// secondary indigo tones and any future surface picks up a distinct color.
const SURFACE_COLORS = ['#6366F1', '#818cf8', '#a5b4fc', '#c7d2fe'];
const SURFACE_LABEL = (s: string) => s === 'unknown' ? 'Unknown' : s.charAt(0).toUpperCase() + s.slice(1);
const WIDGET_LABEL = (w: string) => w === 'unknown' ? 'Unknown' : w.charAt(0).toUpperCase() + w.slice(1);

// Breakdown of currently-installed widgets by (widget kind × surface). Sits
// next to WidgetInstallsChart — that one answers "what fraction of Pro users
// installed anything", this one answers "of those installs, which widget on
// which surface". Current state; ignores dateRange.
export default function WidgetInstallBreakdownChart({ filter = 'all' }: { filter?: ProFilter; dateRange?: DateRange }) {
    const { data: rawRows, loading, error, retry } = useRpcData(
        'widget_install_breakdown',
        { since_date: null },
        parseRow,
    );

    // Pivot to Recharts-friendly rows: one row per widget, one field per surface.
    const { rows, surfaces } = useMemo(() => {
        const surfaceSet = new Set<string>();
        const byWidget: Record<string, Record<string, number>> = {};
        for (const r of rawRows) {
            surfaceSet.add(r.surface);
            if (!byWidget[r.widget]) byWidget[r.widget] = {};
            byWidget[r.widget][r.surface] = (byWidget[r.widget][r.surface] ?? 0) + r.pro;
        }
        // Keep a stable surface order: home, lock, then anything else alphabetical.
        const surfaces = Array.from(surfaceSet).sort((a, b) => {
            const rank = (s: string) => s === 'home' ? 0 : s === 'lock' ? 1 : 2;
            return rank(a) - rank(b) || a.localeCompare(b);
        });
        const rows = Object.entries(byWidget).map(([widget, counts]) => {
            const row: Record<string, string | number> = { widget: WIDGET_LABEL(widget) };
            for (const s of surfaces) row[s] = counts[s] ?? 0;
            return row;
        });
        return { rows, surfaces };
    }, [rawRows]);

    if (loading) return <ChartLoading />;
    if (error) return <ChartError title="Widget Installs by Type" error={error} onRetry={retry} />;
    if (filter === 'false') return <ChartProOnlyPlaceholder title="Widget Installs by Type" />;
    if (rows.length === 0) return <ChartEmpty title="No widget install data" />;

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 md:col-span-2 lg:col-span-1">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900">Widget Installs by Type</h3>
                <p className="text-xs text-gray-500 mt-1">Distinct Pro users currently having each widget installed, split by surface.</p>
            </div>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="widget" tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} tickLine={false} axisLine={false} allowDecimals={false} />
                        <Tooltip
                            cursor={{ fill: '#F9FAFB' }}
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                    return (
                                        <div className="bg-white p-3 border border-gray-100 shadow-lg rounded-xl min-w-[160px]">
                                            <p className="font-semibold text-gray-900 mb-2">{label}</p>
                                            {payload.map((entry, i) => (
                                                <div key={i} className="flex items-center justify-between gap-4 mb-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                                                        <span className="text-sm font-medium text-gray-700">{SURFACE_LABEL(entry.name as string)}</span>
                                                    </div>
                                                    <span className="text-sm font-bold text-gray-900">{(entry.value as number).toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                }
                                return null;
                            }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '10px' }} formatter={(v) => SURFACE_LABEL(v as string)} />
                        {surfaces.map((s, i) => (
                            <Bar
                                key={s}
                                dataKey={s}
                                name={s}
                                fill={SURFACE_COLORS[i % SURFACE_COLORS.length]}
                                radius={[4, 4, 0, 0]}
                                barSize={32}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

"use client";

import { useEffect, useState } from 'react';
import type { DailyPrompt } from '@/lib/dailyPrompts';

const pageSize = 20;
function typeLabel(value: string) { return value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()); }
function audioUrl(value: string | null): string | undefined {
    if (!value) return undefined;
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : undefined; } catch { return undefined; }
}

export default function DailyPromptsPage() {
    const [prompts, setPrompts] = useState<DailyPrompt[]>([]);
    const [type, setType] = useState('');
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setLoading(true); setError('');
        (async () => {
            try {
                const response = await fetch('/api/admin/daily-prompts', { cache: 'no-store', signal: controller.signal });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Could not load daily prompts.');
                if (!controller.signal.aborted) { setPrompts(data.prompts); setPage(0); }
            } catch (e) {
                if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load daily prompts.');
            } finally { if (!controller.signal.aborted) setLoading(false); }
        })();
        return () => controller.abort();
    }, [refresh]);
    const types = [...new Set(prompts.map(prompt => prompt.response_type))].sort();
    const filtered = type ? prompts.filter(prompt => prompt.response_type === type) : prompts;
    const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
    return <div className="space-y-6 text-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="text-2xl font-bold">Daily Prompts</h1><p className="text-gray-600 mt-1">Browse all daily social prompts, including inactive prompts.</p></div>
            <button onClick={() => setRefresh(value => value + 1)} disabled={loading} className="border border-gray-300 rounded-lg px-4 py-2 bg-white disabled:opacity-50">Refresh</button>
        </div>
        <div className="flex flex-wrap gap-4 items-end">
            <div><label htmlFor="prompt-type" className="block text-sm font-medium mb-1">Response type</label>
                <select id="prompt-type" value={type} disabled={loading} onChange={event => { setType(event.target.value); setPage(0); }} className="border border-gray-300 rounded-lg px-3 py-2 bg-white min-w-48">
                    <option value="">All types</option>{types.map(value => <option key={value} value={value}>{typeLabel(value)} ({prompts.filter(prompt => prompt.response_type === value).length})</option>)}
                </select>
            </div>
            {!loading && !error && <p className="text-sm text-gray-500 pb-2">{filtered.length} {filtered.length === 1 ? 'prompt' : 'prompts'}{type ? ` · ${typeLabel(type)}` : ' across all types'}</p>}
        </div>
        {loading ? <p role="status" className="text-gray-500">Loading daily prompts…</p> : error ? <div role="alert" className="bg-red-50 text-red-700 p-4 rounded-lg">{error} <button className="underline ml-2" onClick={() => setRefresh(value => value + 1)}>Retry</button></div> : !filtered.length ? <p className="text-gray-500">No prompts found for this response type.</p> : <>
            <div className="space-y-4">{visible.map(prompt => <article key={prompt.id} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap justify-between gap-3">
                    <div><h2 className="text-lg font-semibold">{prompt.title || prompt.slug}</h2><p className="text-xs text-gray-500 mt-1 break-all">{prompt.slug}</p></div>
                    <div className="flex items-start gap-2 text-xs"><span className="bg-indigo-50 text-indigo-700 rounded-full px-3 py-1">{typeLabel(prompt.response_type)}</span><span className={`rounded-full px-3 py-1 ${prompt.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{prompt.active ? 'Active' : 'Inactive'}</span></div>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                    <section><h3 className="text-xs font-semibold text-gray-500 mb-1">Instructions · Chinese</h3><p className="whitespace-pre-wrap">{prompt.instructions_zh || '—'}</p></section>
                    <section><h3 className="text-xs font-semibold text-gray-500 mb-1">Instructions · English</h3><p className="whitespace-pre-wrap">{prompt.instructions_en || '—'}</p></section>
                    {(prompt.starter_zh || prompt.starter_en) && <><section><h3 className="text-xs font-semibold text-gray-500 mb-1">Starter · Chinese</h3><p className="whitespace-pre-wrap">{prompt.starter_zh || '—'}</p></section><section><h3 className="text-xs font-semibold text-gray-500 mb-1">Starter · English</h3><p className="whitespace-pre-wrap">{prompt.starter_en || '—'}</p></section></>}
                </div>
                {(audioUrl(prompt.question_audio_url) || audioUrl(prompt.starter_audio_url)) && <div className="flex flex-wrap gap-6">
                    {audioUrl(prompt.question_audio_url) && <div><p className="text-xs text-gray-500 mb-1">Question audio</p><audio aria-label="Question audio" controls preload="none" src={audioUrl(prompt.question_audio_url)} /></div>}
                    {audioUrl(prompt.starter_audio_url) && <div><p className="text-xs text-gray-500 mb-1">Starter audio</p><audio aria-label="Starter audio" controls preload="none" src={audioUrl(prompt.starter_audio_url)} /></div>}
                </div>}
                {prompt.hints != null && <details><summary className="text-sm text-gray-600 cursor-pointer">Hints and response details</summary><pre className="mt-2 bg-gray-50 p-3 rounded-lg text-xs whitespace-pre-wrap break-words max-h-80 overflow-auto">{JSON.stringify(prompt.hints, null, 2)}</pre></details>}
                <p className="text-xs text-gray-500">Last used: {prompt.last_used_on || 'Never'} · Created: {prompt.created_at.slice(0, 10)}</p>
            </article>)}</div>
            <div className="flex items-center justify-between gap-4 text-sm">
                <button disabled={page === 0} onClick={() => setPage(value => value - 1)} className="border rounded-lg px-4 py-2 disabled:opacity-40">Previous</button>
                <span className="text-gray-500">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span>
                <button disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage(value => value + 1)} className="border rounded-lg px-4 py-2 disabled:opacity-40">Next</button>
            </div>
        </>}
    </div>;
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Snapshot } from '@/lib/social/metrics'

type Daily = { day: string; instagram: number | null; tiktok: number | null; signups: number | null; instagramReferrals: number | null; tiktokReferrals: number | null; unknownReferrals: number | null }
type Post = Snapshot & { gain: number | null; measuredDays: number }
type Report = { instagramAttempt?: { status: string; stage: string; message: string | null; updated_at: string } | null; signupCoverage: { measuredDays: number; totalDays: number; lastCollectedAt: string | null }; daily: Daily[]; posts: Post[]; sources: Record<string, number>;
    accounts: { platform: string; accountId: string; label: string }[];
    runs: { id: string; platform: string; account_id: string; label: string; started_at: string; status: string; message: string | null; post_count: number | null }[] }
const number = (value: number | null) => value === null ? '—' : value.toLocaleString()
const card = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm'
export default function AcquisitionPage() {
    const [days, setDays] = useState(30)
    const [connectionMessage, setConnectionMessage] = useState('')
    useEffect(() => {
        const url = new URL(window.location.href)
        const error = url.searchParams.get('instagram_error')
        const count = url.searchParams.get('instagram_connected')
        if (error || count) {
            setConnectionMessage(error || `Connected ${count} Instagram account(s). Click Sync now to collect your first snapshot.`)
            // Preserve the result in the URL across reloads/remounts until the next connection attempt.
        }
    }, [])
    const [report, setReport] = useState<Report | null>(null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(true)
    const [syncing, setSyncing] = useState(false)
    const [syncMessage, setSyncMessage] = useState('')
    const [platform, setPlatform] = useState('all')
    const [format, setFormat] = useState('all')
    const [search, setSearch] = useState('')
    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true); setError(''); setReport(null)
        try {
            const response = await fetch(`/api/admin/acquisition?days=${days}`, { signal })
            const body = await response.json()
            if (!response.ok) throw new Error(body.error || 'Could not load report.')
            setReport(body)
        } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load report.') }
        finally { if (!signal?.aborted) setLoading(false) }
    }, [days])
    useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])
    async function runSync() {
        setSyncing(true); setSyncMessage('')
        try {
            const response = await fetch('/api/admin/acquisition', { method: 'POST' })
            const body = await response.json()
            if (body.results) setSyncMessage(body.results.map((r: { label: string; status: string; posts?: number; message?: string }) =>
                `${r.label}: ${r.status === 'success' ? r.posts === undefined ? r.message || 'Synced' : `${r.posts} posts synced` : r.message}`).join(' · '))
            else if (!response.ok) throw new Error(body.error || 'Sync failed.')
            await load()
        } catch (e) { setSyncMessage(e instanceof Error ? e.message : 'Sync failed.') }
        finally { setSyncing(false) }
    }
    const posts = (report?.posts || []).filter(p => (platform === 'all' || p.platform === platform) &&
        (format === 'all' || p.format === format) && `${p.caption} ${p.label}`.toLowerCase().includes(search.toLowerCase()))
    const formats = [...new Set((report?.posts || []).map(p => p.format))]
    const formatData = formats.map(name => ({ name, views: posts.filter(p => p.format === name).reduce((sum, p) => sum + (p.gain || 0), 0) }))
    const signups = report?.daily.reduce((sum, d) => sum + (d.signups ?? 0), 0) || 0
    const referrals = report?.daily.reduce((sum, d) => sum + (d.instagramReferrals ?? 0) + (d.tiktokReferrals ?? 0), 0) || 0
    const measuredViews = posts.some(p => p.gain !== null) ? posts.reduce((sum, p) => sum + (p.gain || 0), 0) : null
    return <div className="mx-auto max-w-7xl space-y-6 text-gray-900">
        <div className="flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-2xl font-bold">Organic acquisition</h1><p className="mt-1 text-gray-600">Compare content momentum with signups and self-reported discovery sources.</p></div>
            <div className="flex gap-3"><select aria-label="Date range" value={days} onChange={e => setDays(Number(e.target.value))} className="rounded-lg border bg-white p-2" disabled={syncing}>
                {[7, 30, 90].map(n => <option key={n} value={n}>Last {n} days</option>)}</select>
                <button onClick={runSync} disabled={syncing || loading} className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">{syncing ? 'Syncing accounts…' : 'Sync now'}</button></div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Signups are not installs. Referral answers are self-reported, and a matching spike does not establish attribution. Views are provider totals; paid distribution has not been separated. Dates use UTC.
        </div>
        {syncMessage && <p role="status" className="rounded-lg bg-indigo-50 p-4 text-sm">{syncMessage}</p>}
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">{error}<button onClick={() => load()} className="ml-3 underline">Retry</button></div>}
        <section className={card}>
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">Instagram connection</h2>
                <p className="mt-1 text-sm text-gray-600">Connect your professional account through Meta to read posts and view insights. Select the Instagram accounts you want to track.</p></div>
                <form action="/api/admin/instagram/connect" method="post"><button className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Connect / reconnect Instagram</button></form>
            </div>
            {report?.instagramAttempt && <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${report.instagramAttempt.status === 'error' ? 'bg-red-50 text-red-800' : 'bg-indigo-50 text-indigo-900'}`}>
                {report.instagramAttempt.message || `Connection ${report.instagramAttempt.status}: ${report.instagramAttempt.stage.replaceAll('_', ' ')}`}
                <span className="ml-2 text-xs">{new Date(report.instagramAttempt.updated_at).toLocaleString()}</span>
                {report.instagramAttempt.status === 'started' && ' If you already finished Meta approval, return here and start Connect Instagram again; the callback has not been recorded.'}
            </p>}
            {report && !report.accounts.some(account => account.platform === 'instagram') && <p className="mt-3 text-sm text-amber-800">Instagram is not connected yet.</p>}
            {connectionMessage && <p role="status" className="mt-3 text-sm">{connectionMessage}</p>}
        </section>
        {loading && <p role="status">Loading acquisition data…</p>}
        {report && <>
            {!report.accounts.length && <div className={card}><h2 className="font-semibold">Connect your accounts</h2><p className="mt-2 text-sm text-gray-600">Connect Instagram above, or configure TikTok using docs/social-acquisition.md, then run your first sync. Two consecutive UTC days of snapshots are needed to measure view gains.</p></div>}
            <p className="text-sm text-gray-500">Signup aggregates available for {report.signupCoverage.measuredDays} / {report.signupCoverage.totalDays} days. {report.signupCoverage.lastCollectedAt ? `Oldest refresh: ${new Date(report.signupCoverage.lastCollectedAt).toUTCString()}.` : 'Run a sync to import daily counts from the app.'} Missing days appear as gaps.</p>
            <div className="grid gap-4 md:grid-cols-3">{[['New signups', number(report?.signupCoverage.measuredDays ? signups : null)], ['Instagram / TikTok survey referrals', number(report?.signupCoverage.measuredDays ? referrals : null)], ['Measured view gains (filtered posts)', number(measuredViews)]].map(([label, value]) => <div key={label} className={card}><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div>
            <section className={card}><h2 className="font-semibold">Content views and signup activity</h2><p className="mb-5 mt-1 text-sm text-gray-500">View gains compare consecutive daily snapshots across all accounts. Missing baselines and counter decreases are gaps; partial coverage can undercount totals. Today is incomplete.</p>
                <div className="h-80"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={report.daily}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" tickFormatter={v => v.slice(5)} />
                    <YAxis yAxisId="views" /><YAxis yAxisId="signups" orientation="right" allowDecimals={false} />
                    <Tooltip /><Legend /><Bar yAxisId="views" dataKey="instagram" name="Instagram view gains" fill="#818cf8" />
                    <Bar yAxisId="views" dataKey="tiktok" name="TikTok view gains" fill="#2dd4bf" />
                    <Line yAxisId="signups" dataKey="signups" name="Signups (right axis)" stroke="#111827" dot={false} />
                    <Line yAxisId="signups" dataKey="instagramReferrals" name="Instagram survey referrals" stroke="#9333ea" dot={false} />
                    <Line yAxisId="signups" dataKey="tiktokReferrals" name="TikTok survey referrals" stroke="#0f766e" dot={false} />
                </ComposedChart></ResponsiveContainer></div></section>
            <div className="grid gap-6 lg:grid-cols-2"><section className={card}><h2 className="mb-4 font-semibold">Signup discovery sources</h2>
                {!Object.keys(report.sources).length ? <p className="text-gray-500">No signup aggregates synced for this period.</p> : <div className="max-h-64 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-gray-500"><th className="py-2">Discovery category</th><th className="text-right">Signups</th></tr></thead><tbody>{Object.entries(report.sources).sort((a, b) => b[1] - a[1]).map(([source, count]) => <tr key={source} className="border-t"><td className="py-2 capitalize">{source}</td><td className="text-right">{number(count)}</td></tr>)}</tbody></table></div>}</section>
                <section className={card}><h2 className="font-semibold">View gains by format</h2><p className="text-sm text-gray-500">Uses the post filters below; measured intervals only.</p>
                    {measuredViews === null ? <p className="mt-6 text-gray-500">Awaiting consecutive daily snapshots.</p> : <div className="h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={formatData}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="views" fill="#818cf8" /></BarChart></ResponsiveContainer></div>}</section></div>
            <section className={card}><h2 className="font-semibold">Which posts gained attention?</h2>
                <div className="my-4 flex flex-wrap gap-3"><select aria-label="Platform" value={platform} onChange={e => setPlatform(e.target.value)} className="rounded-lg border p-2"><option value="all">All platforms</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select>
                    <select aria-label="Content format" value={format} onChange={e => setFormat(e.target.value)} className="rounded-lg border p-2"><option value="all">All formats</option>{formats.map(f => <option key={f}>{f}</option>)}</select>
                    <input aria-label="Search posts or accounts" placeholder="Search caption or account" value={search} onChange={e => setSearch(e.target.value)} className="min-w-56 rounded-lg border p-2" /></div>
                <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-gray-500"><tr><th className="p-2">Post</th><th className="p-2">Format</th><th className="p-2">View gains</th><th className="p-2">Measured days</th><th className="p-2">Lifetime views</th><th className="p-2">Last snapshot</th></tr></thead><tbody>
                    {posts.map(p => <tr key={`${p.platform}:${p.account_id}:${p.post_id}`} className="border-t"><td className="max-w-md p-2"><p className="text-xs capitalize text-gray-500">{p.platform} · {p.label} · Published {p.published_at.slice(0, 10)}</p><p className="my-1 line-clamp-2">{p.caption || 'Untitled post'}</p>{p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">View post ↗</a>}</td><td className="p-2">{p.format}</td><td className="p-2 font-medium">{number(p.gain)}</td><td className="p-2">{p.measuredDays} / {days}</td><td className="p-2">{number(p.views)}</td><td className="whitespace-nowrap p-2">{p.day}</td></tr>)}
                </tbody></table>{!posts.length && <p className="py-6 text-center text-gray-500">No posts match. Sync a connected account to start collecting data.</p>}</div></section>
            <section className={card}><h2 className="mb-3 font-semibold">Account sync status</h2>{report.accounts.map(a => {
                const run = report.runs.find(r => r.platform === a.platform && r.account_id === a.accountId)
                return <div key={`${a.platform}:${a.accountId}`} className="border-t py-3 text-sm"><span className="font-medium">{a.label}</span> <span className="capitalize text-gray-500">({a.platform})</span><p className="mt-1">{run ? `${run.status} · ${new Date(run.started_at).toUTCString()}${run.post_count !== null ? ` · ${run.post_count} posts` : ''}` : 'Not synced yet'}{run?.message ? ` · ${run.message}` : ''}</p></div>
            })}<p className="mt-3 text-xs text-gray-500">Daily history starts when collection is enabled. Older lifetime totals do not reconstruct historical daily views. Store installs and tracked link attribution are not connected yet.</p></section>
        </>}
    </div>
}

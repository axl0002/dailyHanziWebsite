'use client'

import { FormEvent, useRef, useState } from 'react'
import type { Money } from '@/lib/google-play'

type Order = { orderId: string; error?: string; state?: string; createdAt?: string; products?: string;
    total?: Money | null; refunded?: Money | null; refundedAt?: string | null; attemptStatus?: string | null }
function money(value?: Money | null) {
    if (!value) return 'Unavailable'
    const amount = Number(value.units ?? 0) + (value.nanos ?? 0) / 1e9
    return `${new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currencyCode }).format(amount)} ${value.currencyCode}`
}
export default function RefundsPage() {
    const [query, setQuery] = useState('')
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState(false)
    const [refundsEnabled, setRefundsEnabled] = useState<boolean | null>(null)
    const inFlight = useRef(false)
    const [selected, setSelected] = useState<Order | null>(null)
    const [confirmation, setConfirmation] = useState('')
    const [password, setPassword] = useState('')
    const [otp, setOtp] = useState('')
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [warnings, setWarnings] = useState<string[]>([])
    async function search(event?: FormEvent) {
        event?.preventDefault()
        if (inFlight.current) return
        setLoading(true); setError(''); setMessage(''); setWarnings([]); setSelected(null); setConfirmation(''); setPassword(''); setOtp(''); setOrders([])
        try {
            const response = await fetch(`/api/admin/refunds?query=${encodeURIComponent(query.trim())}`, { cache: 'no-store' })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Search failed.')
            setOrders(data.orders)
            setRefundsEnabled(data.refundsEnabled === true)
        } catch (e) { setError(e instanceof Error ? e.message : 'Search failed.') }
        finally { setLoading(false) }
    }
    async function refund() {
        if (!selected || confirmation !== selected.orderId || !password || inFlight.current) return
        inFlight.current = true; setBusy(true); setError(''); setMessage(''); setWarnings([])
        const id = selected.orderId
        try {
            const payload = JSON.stringify({ orderId: id, confirmedOrderId: confirmation, password, otp })
            setPassword(''); setOtp('')
            const response = await fetch('/api/admin/refunds', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: payload })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || 'Refund could not be confirmed.')
            setMessage(data.message); setWarnings(data.warnings ?? [])
            setOrders(rows => rows.map(row => row.orderId === id ? { ...data.order, attemptStatus: 'submitted' } : row))
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Refund result unknown. Refresh and check Play Console.')
            setOrders(rows => rows.map(row => row.orderId === id ? { ...row, attemptStatus: 'refresh_required' } : row))
        } finally { setSelected(null); setConfirmation(''); setPassword(''); setOtp(''); setBusy(false); inFlight.current = false }
    }
    return <div className="space-y-6 max-w-6xl text-gray-900">
        <div><h1 className="text-3xl font-bold">Refund</h1><p className="text-gray-600 mt-2">Find a Google Play order, issue a full refund, and remove paid access.</p></div>
        <form onSubmit={search} className="flex gap-3 bg-white p-6 rounded-xl shadow-sm">
            <div className="flex-1"><label htmlFor="refund-query" className="block text-sm font-medium mb-2">User email or Google Play order ID</label>
                <input id="refund-query" required maxLength={254} value={query} onChange={e => setQuery(e.target.value)} disabled={busy || loading}
                    placeholder="user@example.com or GPA.1234-5678-9012-34567" className="w-full border border-gray-300 rounded-lg px-3 py-2" /></div>
            <button disabled={loading || busy} className="self-end bg-gray-900 text-white px-5 py-2 rounded-lg disabled:opacity-50">{loading ? 'Searching…' : 'Search / refresh'}</button>
        </form>
        {error && <p role="alert" className="p-4 bg-red-50 text-red-800 rounded-lg">{error}</p>}
        {message && <p role="status" className="p-4 bg-green-50 text-green-800 rounded-lg">{message}</p>}
        {warnings.map(warning => <p role="alert" key={warning} className="p-4 bg-amber-50 text-amber-900 rounded-lg">{warning}</p>)}
        {refundsEnabled === false && <p role="status" className="p-4 bg-amber-50 text-amber-900 rounded-lg">Refund execution is disabled by the server. Orders can be reviewed, but no refund can be issued until an operator enables it.</p>}
        {orders.length > 0 && <div className="overflow-x-auto rounded-xl bg-white shadow-sm"><table className="w-full text-sm text-left">
            <thead className="bg-gray-50"><tr>{['Order / product', 'Status', 'Order value', 'Refunded', 'Action'].map(label => <th key={label} className="p-4">{label}</th>)}</tr></thead>
            <tbody>{orders.map(order => <tr key={order.orderId} className="border-t border-gray-100">
                <td className="p-4"><div className="font-mono">{order.orderId}</div><div>{order.products}</div>{order.createdAt && <div className="text-gray-500">{new Date(order.createdAt).toLocaleString()}</div>}</td>
                {order.error ? <td colSpan={4} className="p-4 text-red-700">{order.error}</td> : <>
                    <td className="p-4">{order.state}{order.attemptStatus && <div className="text-xs text-amber-800">{order.attemptStatus.replaceAll('_', ' ')}</div>}</td>
                    <td className="p-4 whitespace-nowrap">{money(order.total)}</td><td className="p-4 whitespace-nowrap">{money(order.refunded)}{order.refundedAt && <div className="text-xs text-gray-500">{new Date(order.refundedAt).toLocaleString()}</div>}</td>
                    <td className="p-4"><button disabled={busy || loading || refundsEnabled !== true || order.state !== 'PROCESSED' || !!order.attemptStatus} onClick={() => { setSelected(order); setConfirmation(''); setPassword(''); setOtp('') }}
                        className="bg-red-600 text-white px-3 py-2 rounded-lg disabled:opacity-40">Refund &amp; remove access</button></td>
                </>}
            </tr>)}</tbody></table></div>}
        {selected && <section aria-label="Confirm refund" className="bg-white border border-red-200 rounded-xl p-6 space-y-4">
            <h2 className="text-lg font-semibold">Confirm refund and remove access</h2>
            <p>Refund the full order value of <strong>{money(selected.total)}</strong> for <strong className="font-mono">{selected.orderId}</strong>. Paid access will be revoked and subscription renewals stopped. This cannot be undone.</p>
            <label htmlFor="refund-confirm" className="block text-sm font-medium">Type the order ID to confirm</label>
            <input id="refund-confirm" autoComplete="off" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono" />
            <label htmlFor="refund-password" className="block text-sm font-medium">Your admin password</label>
            <input id="refund-password" type="password" autoComplete="current-password" value={password} disabled={busy} onChange={e => setPassword(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            <label htmlFor="refund-otp" className="block text-sm font-medium">Authenticator code (if two-factor authentication is enabled)</label>
            <input id="refund-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} disabled={busy} onChange={e => setOtp(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2" />
            <p className="text-sm text-gray-600">Each refund requires fresh password verification. Safety limits: 3 per person and 5 per app in 24 hours, with a 60-second cooldown.</p>
            <div className="flex gap-3"><button disabled={busy || confirmation !== selected.orderId || !password} onClick={refund} className="bg-red-600 text-white px-4 py-2 rounded-lg disabled:opacity-40">{busy ? 'Submitting…' : 'Confirm refund & remove access'}</button>
                <button disabled={busy} onClick={() => { setSelected(null); setPassword(''); setOtp('') }} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button></div>
        </section>}
        <p className="text-sm text-gray-500">Email searches show up to 10 recent Google Play orders from purchase records. For subscriptions, select the latest paid order. Refunded amounts include confirmed refunds only; pending refunds may take time to appear. Apple purchases must be handled through Apple.</p>
    </div>
}

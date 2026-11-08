import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { accessToken, getOrder, orderSummary, packageName, play, RefundError } from '@/lib/google-play'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const orderPattern = /^GPA\.\d{4}-\d{4}-\d{4}-\d{5}(?:\.\.\d+)?$/

async function context() {
    const jar = await cookies()
    const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookies: { getAll: () => jar.getAll(), setAll: () => {} },
    })
    const { data: { user } } = await auth.auth.getUser()
    if (!user) throw new RefundError('Please sign in.', 401)
    const { data: roles, error } = await auth.from('user_roles').select('role').eq('user_id', user.id).in('role', ['admin', 'moderator'])
    if (error || !roles?.length) throw new RefundError('Admin or moderator access required.', 403)
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!key) throw new RefundError('Refund setup incomplete: configure SUPABASE_SERVICE_ROLE_KEY on the server.', 503)
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } })
    return { user, db }
}
function failure(error: unknown) {
    return NextResponse.json({ error: error instanceof RefundError ? error.message : 'Request could not be completed. Refresh the order before trying again.' }, {
        status: error instanceof RefundError ? error.status : 500, headers: { 'Cache-Control': 'no-store' },
    })
}

export async function GET(request: Request) {
    try {
        const { db } = await context()
        const query = new URL(request.url).searchParams.get('query')?.trim() ?? ''
        if (!query || query.length > 254) throw new RefundError('Enter an exact email address or Google Play order ID.')
        let ids: string[] = []
        if (orderPattern.test(query)) ids = [query]
        else {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) throw new RefundError('Enter an exact email address or an order ID beginning GPA.')
            // Escape LIKE wildcards to make email lookup exact and case-insensitive.
            const { data: profiles, error } = await db.from('profiles').select('id').ilike('email', query.replace(/[\\%_]/g, '\\$&')).limit(2)
            if (error) throw new RefundError('Could not search users.', 500)
            if (profiles?.length !== 1) throw new RefundError(profiles?.length ? 'More than one user has this email. Search by order ID.' : 'No user found with this email.', 404)
            const { data: events, error: eventError } = await db.from('subscription_events').select('raw').eq('user_id', profiles[0].id)
                .eq('store', 'PLAY_STORE').order('event_timestamp', { ascending: false }).limit(100)
            if (eventError) throw new RefundError('Could not look up purchases.', 500)
            ids = [...new Set((events ?? []).map(e => e.raw?.transaction_id).filter((id): id is string => typeof id === 'string' && orderPattern.test(id)))].slice(0, 10)
            if (!ids.length) throw new RefundError('No Google Play orders found for this email. Try the GPA order ID from the receipt.', 404)
        }
        const token = await accessToken()
        const results = await Promise.all(ids.map(async id => {
            try {
                const order = await getOrder(token, id)
                const { data: audit, error } = await db.from('play_refunds').select('status').eq('package_name', packageName()).eq('order_id', id).maybeSingle()
                if (error) throw new RefundError('Refund setup incomplete: apply supabase/policies/play_refunds.sql.', 503)
                return { ...orderSummary(order), attemptStatus: audit?.status ?? null }
            } catch (error) { return { orderId: id, error: error instanceof RefundError ? error.message : 'Could not load this order.' } }
        }))
        return NextResponse.json({ orders: results }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
    try {
        if (request.headers.get('origin') !== new URL(request.url).origin) throw new RefundError('Invalid request origin.', 403)
        const { user, db } = await context()
        let body
        try { body = await request.json() } catch { throw new RefundError('Invalid request.') }
        const { orderId, confirmedOrderId } = body ?? {}
        if (typeof orderId !== 'string' || !orderPattern.test(orderId) || confirmedOrderId !== orderId) throw new RefundError('Confirm the exact order ID before issuing the refund.')
        const token = await accessToken()
        const order = await getOrder(token, orderId)
        if (order.state !== 'PROCESSED') throw new RefundError(`This order cannot be refunded here (status: ${order.state}).`)
        if (!order.total || (Number(order.total.units ?? 0) + (order.total.nanos ?? 0) / 1e9) <= 0) throw new RefundError('This order has no refundable payment.')
        const cutoff = new Date(); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3)
        if (!Number.isFinite(Date.parse(order.createTime)) || new Date(order.createTime) < cutoff) throw new RefundError('Orders must be less than three years old.')
        const isSubscription = order.lineItems?.some(item => !!item.subscriptionDetails)
        if (!isSubscription && (!order.lineItems?.length || !order.lineItems.every(item => !!item.oneTimePurchaseDetails))) throw new RefundError('Only in-app purchases and subscriptions are supported.')
        if (isSubscription) {
            if (!order.purchaseToken) throw new RefundError('Google did not provide the purchase token; use Play Console.')
            const subscription = await play<{ lineItems?: { latestSuccessfulOrderId?: string }[] }>(token, `purchases/subscriptionsv2/tokens/${encodeURIComponent(order.purchaseToken)}`)
            if (!subscription.lineItems?.length || subscription.lineItems.some(item => item.latestSuccessfulOrderId !== orderId)) {
                throw new RefundError('Select the latest paid order for this subscription to refund and remove access. Older orders cannot be refunded from this tab.')
            }
        }
        // Resolve ownership on the server; never trust a client-provided user ID.
        const { data: owners, error: ownerError } = await db.from('subscription_events').select('user_id').eq('store', 'PLAY_STORE')
            .eq('raw->>transaction_id', orderId).not('user_id', 'is', null).limit(100)
        if (ownerError) throw new RefundError('Could not verify order ownership.', 500)
        const userIds = [...new Set((owners ?? []).map(e => e.user_id as string))]
        if (userIds.length > 1) throw new RefundError('Order is linked to multiple users. Resolve ownership before refunding.')
        const ownerId = userIds[0] ?? null
        // Unique constraint serializes duplicate clicks and concurrent staff requests.
        const { error: lockError } = await db.from('play_refunds').insert({ package_name: packageName(), order_id: orderId, actor_id: user.id,
            user_id: ownerId, status: 'processing', order_total: order.total })
        if (lockError) throw new RefundError(lockError.code === '23505' ? 'A refund has already been attempted for this order. Refresh and check Play Console before any further action.' :
            'Could not record the refund. Apply supabase/policies/play_refunds.sql before issuing refunds.', 409)
        let accepted = false
        const warnings: string[] = []
        try {
            if (isSubscription) await play(token, `purchases/subscriptionsv2/tokens/${encodeURIComponent(order.purchaseToken!)}:revoke`, { revocationContext: { fullRefund: {} } })
            else await play(token, `orders/${encodeURIComponent(orderId)}:refund?revoke=true`, null)
            accepted = true
        } catch {
            await db.from('play_refunds').update({ status: 'needs_review' }).eq('package_name', packageName()).eq('order_id', orderId)
            throw new RefundError('Google did not confirm the result. The attempt is locked to prevent duplicate refunds. Check Play Console and reconcile the audit record.', 502)
        }
        if (accepted && ownerId) {
            const { error } = await db.from('profiles').update({ is_pro: false, pro_expires_at: new Date().toISOString() }).eq('id', ownerId).select('id').single()
            if (error) warnings.push('Google access was revoked, but the local Pro profile could not be updated. Reconcile this user manually.')
        } else warnings.push('Google access was revoked. No linked local user was found; verify app entitlement synchronization.')
        let refreshed = orderSummary(order)
        try { refreshed = orderSummary(await getOrder(token, orderId)) }
        catch { warnings.push('Refund accepted. Google order totals could not be refreshed yet; refresh the order shortly.') }
        const { error: auditError } = await db.from('play_refunds').update({ status: warnings.length ? 'needs_review' : 'submitted',
            refund_total: refreshed.refunded, completed_at: new Date().toISOString(), warnings }).eq('package_name', packageName()).eq('order_id', orderId)
        if (auditError) warnings.push('Refund accepted, but the audit result could not be saved. Reconcile the audit record manually.')
        return NextResponse.json({ ok: true, order: refreshed, warnings, message: 'Google accepted the full refund and access revocation. The bank payment may take time to complete.' }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) { return failure(error) }
}

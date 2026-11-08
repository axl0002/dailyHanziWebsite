import 'server-only'
import { createSign } from 'node:crypto'

export type Money = { currencyCode: string; units?: string; nanos?: number }
export type PlayOrder = {
    orderId: string; purchaseToken?: string; state: string; createTime: string; total?: Money;
    lineItems?: { productId: string; productTitle?: string; subscriptionDetails?: object; oneTimePurchaseDetails?: object }[];
    orderHistory?: {
        refundEvent?: { eventTime?: string; refundDetails?: { total?: Money } };
        partialRefundEvents?: { state: string; refundDetails?: { total?: Money } }[];
    };
}
export class RefundError extends Error {
    constructor(message: string, public status = 400) { super(message) }
}
const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
export function packageName() {
    const value = process.env.GOOGLE_PLAY_PACKAGE_NAME
    if (!value) throw new RefundError('Refund setup incomplete: configure GOOGLE_PLAY_PACKAGE_NAME on the server.', 503)
    return value
}
export async function accessToken() {
    const value = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
    if (!value) throw new RefundError('Refund setup incomplete: configure GOOGLE_PLAY_SERVICE_ACCOUNT_JSON on the server.', 503)
    try {
        const account = JSON.parse(value)
        const now = Math.floor(Date.now() / 1000)
        const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url')
        const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
            iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
            aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
        })}`
        const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url')
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
            cache: 'no-store', signal: AbortSignal.timeout(15000),
        })
        const token = await response.json()
        if (!response.ok || !token.access_token) throw new Error('Token request failed')
        return token.access_token as string
    } catch { throw new RefundError('Google Play authentication failed. Check the server service account configuration.', 503) }
}
export async function play<T>(token: string, path: string, body?: object | null): Promise<T> {
    const response = await fetch(`${base}${encodeURIComponent(packageName())}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) {
        // Do not expose Google responses containing purchase tokens or customer data.
        throw new RefundError(response.status === 404 ? 'Order or purchase not found in this app.' :
            `Google Play request failed (${response.status}). Check permissions and order eligibility in Play Console.`, response.status === 404 ? 404 : 502)
    }
    const text = await response.text()
    return (text ? JSON.parse(text) : {}) as T
}
export const getOrder = (token: string, id: string) => play<PlayOrder>(token, `orders/${encodeURIComponent(id)}`)
export function orderSummary(order: PlayOrder) {
    const full = order.orderHistory?.refundEvent?.refundDetails?.total
    const partials = order.orderHistory?.partialRefundEvents?.filter(e => e.state === 'PROCESSED_SUCCESSFULLY') ?? []
    // A full-refund event describes that event's amount; include earlier partial refunds.
    const amounts = [...partials.map(e => e.refundDetails?.total), full].filter((m): m is Money => !!m)
    const currency = order.total?.currencyCode
    let refunded: Money | null = null
    if (currency && amounts.every(m => m.currencyCode === currency)) {
        const nanos = amounts.reduce((n, m) => n + BigInt(m.units ?? '0') * BigInt(1000000000) + BigInt(m.nanos ?? 0), BigInt(0))
        refunded = { currencyCode: currency, units: String(nanos / BigInt(1000000000)), nanos: Number(nanos % BigInt(1000000000)) }
    }
    // Do not show zero when Google reports a refund but omits monetary details.
    if (partials.some(e => !e.refundDetails?.total) ||
        (order.state === 'REFUNDED' && !full) ||
        (order.state === 'PARTIALLY_REFUNDED' && amounts.length === 0)) refunded = null
    return { orderId: order.orderId, state: order.state, createdAt: order.createTime, total: order.total ?? null,
        refunded, products: order.lineItems?.map(i => i.productTitle || i.productId).join(', ') || 'Purchase',
        refundedAt: order.orderHistory?.refundEvent?.eventTime ?? null }
}

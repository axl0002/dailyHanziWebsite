// No network calls or real payments. Run: node --test tests/play-refunds.test.cjs
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const id = 'GPA.1234-5678-9012-34567..0'
const total = { currencyCode: 'USD', units: '10', nanos: 250000000 }
function load(relative, mocks = {}) {
    const filename = path.join(__dirname, '..', relative)
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(source, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name),
        process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secret' } },
        Buffer, AbortSignal, URL, URLSearchParams, Date, console }, { filename })
    return module.exports
}
const google = load('lib/google-play.ts', { 'server-only': {} })
function fixture(options = {}) {
    const writes = [], calls = []
    const order = { orderId: id, createTime: new Date().toISOString(), state: 'PROCESSED', total,
        purchaseToken: 'private-token', lineItems: [{ productId: 'pro', subscriptionDetails: {} }], ...options.order }
    function query(result) {
        const q = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }
        for (const method of ['select','eq','in','not','limit','order','ilike','single','maybeSingle']) q[method] = () => q
        return q
    }
    const db = { from: table => ({
        select: () => query(table === 'profiles' ? { data: [{ id: 'owner' }] } : table === 'play_refunds' ? { data: null } : { data: [{ user_id: 'owner', raw: { transaction_id: id } }] }),
        insert: data => { writes.push({ table, operation: 'insert', data }); return Promise.resolve({ error: options.duplicate ? { code: '23505' } : null }) },
        update: data => { writes.push({ table, operation: 'update', data }); return query({ error: table === 'profiles' && options.profileError ? { message: 'fail' } : null }) },
    }) }
    const auth = { auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id: 'staff' } } }) },
        from: () => ({ select: () => query({ data: options.forbidden ? [] : [{ role: 'moderator' }] }) }) }
    const module = load('app/api/admin/refunds/route.ts', {
        'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
        '@supabase/ssr': { createServerClient: () => auth }, '@supabase/supabase-js': { createClient: () => db },
        'next/headers': { cookies: async () => ({ getAll: () => [] }) },
        '@/lib/google-play': { ...google, packageName: () => 'test.app', accessToken: async () => 'secret',
            getOrder: async () => order,
            play: async (_token, endpoint, body) => {
                calls.push({ endpoint, body })
                if (body === undefined) return { lineItems: [{ latestSuccessfulOrderId: options.oldOrder ? 'different-order' : id }] }
                if (options.googleError) throw new Error('Timeout')
                return {}
            } },
    })
    const request = (body = { orderId: id, confirmedOrderId: id }, origin = 'https://admin.example.com') => ({
        url: 'https://admin.example.com/api/admin/refunds', headers: new Headers({ origin }), json: async () => body,
    })
    return { ...module, writes, calls, request }
}

test('money preserves nanos and only counts completed partial refunds', () => {
    const result = google.orderSummary({ orderId: id, state: 'PARTIALLY_REFUNDED', total, orderHistory: { partialRefundEvents: [
        { state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total: { currencyCode: 'USD', units: '1', nanos: 500000000 } } },
        { state: 'PENDING', refundDetails: { total } },
    ] } })
    assert.equal(result.refunded.units, '1'); assert.equal(result.refunded.nanos, 500000000)
})
test('missing refunded amounts are never presented as zero', () => {
    assert.equal(google.orderSummary({ orderId: id, state: 'REFUNDED', total }).refunded, null)
})
test('never sums currencies together', () => {
    assert.equal(google.orderSummary({ orderId: id, state: 'REFUNDED', total,
        orderHistory: { refundEvent: { refundDetails: { total: { currencyCode: 'EUR', units: '5' } } } } }).refunded, null)
})
test('unauthenticated and unprivileged callers cannot refund', async () => {
    for (const options of [{ anonymous: true }, { forbidden: true }]) {
        const f = fixture(options), r = await f.POST(f.request())
        assert.equal(r.status, options.anonymous ? 401 : 403); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 0)
    }
})
test('rejects cross-origin requests and mismatched confirmation', async () => {
    const f = fixture()
    assert.equal((await f.POST(f.request(undefined, 'https://other.example'))).status, 403)
    assert.equal((await f.POST(f.request({ orderId: id, confirmedOrderId: 'wrong' }))).status, 400)
    assert.equal(f.writes.length, 0)
})
test('refunded or pending orders cannot be refunded again', async () => {
    for (const state of ['REFUNDED', 'PENDING_REFUND', 'PARTIALLY_REFUNDED', 'CANCELED']) {
        const f = fixture({ order: { state } })
        assert.equal((await f.POST(f.request())).status, 400); assert.equal(f.writes.length, 0)
    }
})
test('old subscription orders cannot revoke a newer billing period', async () => {
    const f = fixture({ oldOrder: true })
    assert.equal((await f.POST(f.request())).status, 400); assert.equal(f.writes.length, 0)
})
test('unique audit lock prevents a second refund request', async () => {
    const f = fixture({ duplicate: true })
    assert.equal((await f.POST(f.request())).status, 409)
    assert.equal(f.calls.filter(c => c.body !== undefined).length, 0)
})
test('moderator can revoke and refund subscription; profile changes follow Google success', async () => {
    const f = fixture(), result = await f.POST(f.request())
    assert.equal(result.status, 200)
    assert.ok(f.calls.some(c => c.endpoint.endsWith(':revoke') && c.body.revocationContext.fullRefund))
    assert.ok(f.writes.some(w => w.table === 'profiles' && w.data.is_pro === false))
    assert.ok(!JSON.stringify(result.body).includes('private-token'))
})
test('one-time refund always requests revocation', async () => {
    const f = fixture({ order: { lineItems: [{ oneTimePurchaseDetails: {} }] } })
    assert.equal((await f.POST(f.request())).status, 200)
    assert.ok(f.calls.some(c => c.endpoint.endsWith(':refund?revoke=true')))
})
test('unknown Google result locks attempt and never changes entitlement locally', async () => {
    const f = fixture({ googleError: true })
    assert.equal((await f.POST(f.request())).status, 502)
    assert.ok(f.writes.some(w => w.data.status === 'needs_review'))
    assert.ok(!f.writes.some(w => w.table === 'profiles'))
})
test('local update failure reports partial success without retrying payment', async () => {
    const f = fixture({ profileError: true }), result = await f.POST(f.request())
    assert.equal(result.status, 200); assert.ok(result.body.warnings.length > 0)
    assert.equal(f.calls.filter(c => c.body !== undefined).length, 1)
})
test('search by email resolves stored Google Play transaction and strips purchase token', async () => {
    const f = fixture(), result = await f.GET({ url: 'https://admin.example.com/api/admin/refunds?query=person%40example.com' })
    assert.equal(result.status, 200); assert.equal(result.body.orders[0].orderId, id)
    assert.equal(result.body.orders[0].total.currencyCode, 'USD')
    assert.ok(!JSON.stringify(result.body).includes('private-token'))
})

test('incomplete refund history does not understate the refunded amount', () => {
    assert.equal(google.orderSummary({ orderId: id, state: 'REFUNDED', total,
        orderHistory: { partialRefundEvents: [{ state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total } }] } }).refunded, null)
    assert.equal(google.orderSummary({ orderId: id, state: 'PARTIALLY_REFUNDED', total,
        orderHistory: { partialRefundEvents: [{ state: 'PROCESSED_SUCCESSFULLY' }] } }).refunded, null)
})

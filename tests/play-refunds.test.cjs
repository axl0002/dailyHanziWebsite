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
        process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'secret', GOOGLE_PLAY_REFUNDS_ENABLED: mocks.__disabled ? 'false' : 'true' } },
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
    const db = { rpc: async (name, data) => {
        if (name === 'claim_play_refund_auth_attempt') {
            writes.push({ table: 'play_refund_auth_attempts', data })
            return { data: !options.authLimited, error: null }
        }
        assert.equal(name, 'reserve_play_refund')
        writes.push({ table: 'play_refunds', operation: 'reserve', data })
        return { error: options.refundLimited ? { code: 'P0001' } : options.duplicate ? { code: '23505' } : null }
    }, from: table => ({
        select: () => query(table === 'profiles' ? { data: [{ id: 'owner' }] } : table === 'play_refunds' ? { data: null } : { data: [{ user_id: 'owner', raw: { transaction_id: id } }] }),
        insert: data => { writes.push({ table, operation: 'insert', data }); return Promise.resolve({ error: options.duplicate ? { code: '23505' } : null }) },
        update: data => { writes.push({ table, operation: 'update', data }); return query({ error: table === 'profiles' && options.profileError ? { message: 'fail' } : null }) },
    }) }
    const auth = { auth: {
        signInWithPassword: async () => ({ data: { user: { id: options.wrongActor ? 'other-user' : 'staff' } }, error: options.badPassword ? { message: 'invalid password' } : null }),
        getUser: async () => ({ data: { user: options.anonymous ? null : { id: 'staff', email: 'staff@example.test' } } }) },
        from: () => ({ select: () => query({ data: options.forbidden ? [] : [{ role: 'moderator' }] }) }) }
    const module = load('app/api/admin/refunds/route.ts', {
        __disabled: options.disabled,
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
    const request = (body = { orderId: id, confirmedOrderId: id, password: 'private-password' }, origin = 'https://admin.example.com') => ({
        url: 'https://admin.example.com/api/admin/refunds', headers: new Headers({ origin }), json: async () => body, text: async () => JSON.stringify(body),
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
        assert.equal(r.status, options.anonymous ? 401 : 403); assert.equal(f.writes.filter(w => w.table === 'play_refunds').length, 0); assert.equal(f.calls.length, 0)
    }
})
test('rejects cross-origin requests and mismatched confirmation', async () => {
    const f = fixture()
    assert.equal((await f.POST(f.request(undefined, 'https://other.example'))).status, 403)
    assert.equal((await f.POST(f.request({ orderId: id, confirmedOrderId: 'wrong' }))).status, 400)
    assert.equal(f.writes.filter(w => w.table === 'play_refunds').length, 0)
})
test('refunded or pending orders cannot be refunded again', async () => {
    for (const state of ['REFUNDED', 'PENDING_REFUND', 'PARTIALLY_REFUNDED', 'CANCELED']) {
        const f = fixture({ order: { state } })
        assert.equal((await f.POST(f.request())).status, 400); assert.equal(f.writes.filter(w => w.table === 'play_refunds').length, 0)
    }
})
test('old subscription orders cannot revoke a newer billing period', async () => {
    const f = fixture({ oldOrder: true })
    assert.equal((await f.POST(f.request())).status, 400); assert.equal(f.writes.filter(w => w.table === 'play_refunds').length, 0)
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

test('full refunds do not double count earlier partial refund events', () => {
    const result = google.orderSummary({ orderId: id, state: 'REFUNDED', total, orderHistory: {
        partialRefundEvents: [{ state: 'PROCESSED_SUCCESSFULLY', refundDetails: { total: { currencyCode: 'USD', units: '1' } } }],
        refundEvent: { refundDetails: { total } },
    } })
    assert.equal(result.refunded.units, total.units); assert.equal(result.refunded.nanos, total.nanos)
})
test('orders without a supported purchase line cannot initiate a refund', async () => {
    for (const lineItems of [[], [{}]]) {
        const f = fixture({ order: { lineItems } })
        assert.equal((await f.POST(f.request())).status, 400); assert.equal(f.writes.filter(w => w.table === 'play_refunds').length, 0)
    }
})

test('refund execution is disabled unless explicitly enabled on the server', async () => {
    const f = fixture({ disabled: true })
    assert.equal((await f.POST(f.request())).status, 503); assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0)
})
test('fresh password and same-user identity are enforced before Google requests', async () => {
    for (const options of [{ badPassword: true }, { wrongActor: true }]) {
        const f = fixture(options)
        assert.equal((await f.POST(f.request())).status, 403); assert.equal(f.calls.length, 0)
        assert.ok(!f.writes.some(w => w.table === 'play_refunds')); assert.ok(!JSON.stringify(f.writes).includes('private-password'))
    }
    const f = fixture()
    assert.equal((await f.POST(f.request({ orderId: id, confirmedOrderId: id }))).status, 400); assert.equal(f.calls.length, 0)
})
test('authorization and refund budgets reject requests before any Google mutation', async () => {
    for (const options of [{ authLimited: true }, { refundLimited: true }]) {
        const f = fixture(options)
        assert.equal((await f.POST(f.request())).status, 429)
        assert.equal(f.calls.filter(c => c.body !== undefined).length, 0)
    }
})

test('oversized requests and client-supplied roles cannot bypass server checks', async () => {
    const f = fixture()
    assert.equal((await f.POST(f.request({ orderId: id, confirmedOrderId: id, password: 'private-password', extra: 'x'.repeat(17000) }))).status, 413)
    assert.equal(f.calls.length, 0)
    const blocked = fixture({ forbidden: true })
    assert.equal((await blocked.POST(blocked.request({ orderId: id, confirmedOrderId: id, password: 'private-password', role: 'admin', actor_id: 'staff' }))).status, 403)
    assert.equal(blocked.calls.length, 0)
})

test('refund authorization requires no authenticator API or code', async () => {
    // The auth mock intentionally has no MFA methods. Password verification
    // must still allow the refund without requesting an authenticator code.
    const f = fixture()
    const result = await f.POST(f.request({ orderId: id, confirmedOrderId: id, password: 'private-password' }))
    assert.equal(result.status, 200)
    assert.ok(!JSON.stringify(f.writes).includes('private-password'))
})

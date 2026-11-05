const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(file, mocks = {}, globals = {}) {
    const module = { exports: {} }
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    vm.runInNewContext(source, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name),
        process: { env: {} }, URL, URLSearchParams, AbortSignal, Date, Buffer, ...globals })
    return module.exports
}
const metrics = load('lib/social/metrics.ts')
const row = (day, views, extra = {}) => ({ platform: 'instagram', account_id: 'a', post_id: 'p', day, views, ...extra })
test('daily gains require consecutive observed days and nondecreasing known counters', () => {
    assert.equal(metrics.dailyGain(row('2026-11-05', 150), row('2026-11-04', 100)), 50)
    assert.equal(metrics.dailyGain(row('2026-11-05', 150)), null)
    assert.equal(metrics.dailyGain(row('2026-11-05', 150), row('2026-11-03', 100)), null)
    assert.equal(metrics.dailyGain(row('2026-11-05', 50), row('2026-11-04', 100)), null)
    assert.equal(metrics.dailyGain(row('2026-11-05', null), row('2026-11-04', 100)), null)
    assert.equal(metrics.dailyGain(row('2026-11-05', 0), row('2026-11-04', 0)), 0)
})
test('summary uses pre-range baseline and isolates identical post IDs across accounts', () => {
    const result = metrics.summarize([row('2026-11-03', 100), row('2026-11-04', 130), row('2026-11-05', 180),
        row('2026-11-04', 999, { account_id: 'other' })], '2026-11-04', '2026-11-05')
    assert.equal(result.posts[0].gain, 80)
    assert.equal(result.posts[0].measuredDays, 2)
    assert.equal(result.posts[1].gain, null)
    assert.equal(result.daily[0].instagram, 30)
    assert.equal(result.daily[0].tiktok, null)
})
test('links and unknown metrics are not fabricated', () => {
    assert.equal(metrics.safePostUrl('javascript:alert(1)', 'instagram'), null)
    assert.equal(metrics.safePostUrl('https://instagram.com.evil.test/p/1', 'instagram'), null)
    assert.equal(metrics.safePostUrl('https://www.instagram.com/p/1', 'instagram'), 'https://www.instagram.com/p/1')
    for (const value of [undefined, '100', -1, Infinity, 1.5]) assert.equal(metrics.counter(value), null)
    assert.equal(metrics.counter(0), 0)
})
function providers(responses, calls = []) {
    return load('lib/social/providers.ts', { './metrics': metrics }, { fetch: async (url, init) => {
        calls.push({ url: url.toString(), init })
        const body = responses.shift()
        return { ok: body.ok !== false, status: body.status || 200, json: async () => body }
    } })
}
const account = { platform: 'tiktok', accountId: 'a', label: 'Test', accessToken: 'private-token' }
test('TikTok paginates public videos with authorization in headers', async () => {
    const calls = []
    const api = providers([
        { error: { code: 'ok' }, data: { videos: [{ id: '1', create_time: 1700000000, view_count: 10 }], has_more: true, cursor: 100 } },
        { error: { code: 'ok' }, data: { videos: [{ id: '2', create_time: 1700000001, view_count: 20 }], has_more: false } },
    ], calls)
    const rows = await api.collect(account, new Date('2026-11-05T00:05:00Z'))
    assert.equal(rows.length, 2); assert.equal(rows[0].views, 10); assert.equal(rows[0].likes, null)
    assert.equal(JSON.parse(calls[1].init.body).cursor, 100)
    assert.equal(calls[0].init.headers.Authorization, 'Bearer private-token')
    assert.ok(!calls[0].url.includes('private-token'))
})
test('provider errors reject collection instead of returning partial snapshots', async () => {
    const api = providers([
        { data: { videos: [{ id: '1', create_time: 1700000000 }], has_more: true, cursor: 100 } },
        { error: { code: 'access_token_invalid', message: 'private provider body' } },
    ])
    await assert.rejects(api.collect(account), /Provider rejected/)
})
test('Instagram distinguishes Reels and carousels and does not follow provider next URLs', async () => {
    const calls = []
    const api = providers([
        { data: [{ id: '1', timestamp: '2026-01-01T00:00:00Z', media_type: 'VIDEO', media_product_type: 'REELS' }],
            paging: { next: 'https://evil.test/leak', cursors: { after: 'cursor' } } },
        { data: [{ name: 'views', values: [{ value: 123 }] }] },
        { data: [{ id: '2', timestamp: '2026-01-01T00:00:00Z', media_type: 'CAROUSEL_ALBUM' }] },
        { data: [] },
    ], calls)
    const rows = await api.collect({ ...account, platform: 'instagram' })
    assert.equal(rows[0].format, 'Reel'); assert.equal(rows[0].views, 123)
    assert.equal(rows[1].format, 'Carousel'); assert.equal(rows[1].views, null)
    assert.ok(calls.every(call => new URL(call.url).hostname === 'graph.facebook.com'))
    assert.equal(new URL(calls[2].url).searchParams.get('after'), 'cursor')
})
test('rotated TikTok refresh tokens persist before use and identity is checked', async () => {
    let saved
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { refresh_token: 'stored' } }) }) }),
        upsert: async value => { saved = value; return {} } }) }
    let identity = 'a'
    const tokens = load('lib/social/tiktok-token.ts', {}, { process: { env: { TIKTOK_CLIENT_KEY: 'key', TIKTOK_CLIENT_SECRET: 'secret' } },
        fetch: async (_url, init) => {
            assert.equal(init.body.get('refresh_token'), 'stored')
            return { ok: true, json: async () => ({ open_id: identity, access_token: 'new', refresh_token: 'rotated' }) }
        } })
    assert.equal(await tokens.tiktokToken({ ...account, refreshToken: 'seed' }, db), 'new')
    assert.equal(saved.refresh_token, 'rotated')
    identity = 'other'; saved = undefined
    await assert.rejects(tokens.tiktokToken({ ...account, refreshToken: 'seed' }, db), /does not match/)
    assert.equal(saved, undefined)
})
test('cron rejects missing and incorrect authorization without starting a sync', async () => {
    let calls = 0
    class SocialError extends Error { constructor(message, status) { super(message); this.status = status } }
    const route = load('app/api/cron/social-sync/route.ts', {
        'next/server': { NextResponse: { json: (body, init) => ({ body, ...init }) } },
        '@/lib/social/sync': { sync: async () => { calls++; return [] } },
        '@/lib/social/server': { SocialError, failure: error => ({ status: error.status }) },
    }, { process: { env: { CRON_SECRET: 'private-cron' } } })
    for (const token of ['', 'Bearer wrong']) assert.equal((await route.GET({ headers: new Headers({ authorization: token }) })).status, 401)
    assert.equal(calls, 0)
    assert.equal((await route.GET({ headers: new Headers({ authorization: 'Bearer private-cron' }) })).status, 200)
    assert.equal(calls, 1)
})
test('staff authorization validates the user and requires admin role', async () => {
    for (const scenario of ['anonymous', 'moderator', 'admin']) {
        const auth = { auth: { getUser: async () => ({ data: { user: scenario === 'anonymous' ? null : { id: 'staff' } } }) },
            from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: scenario === 'admin' ? [{ role: 'admin' }] : [] }) }) }) }) }
        const server = load('lib/social/server.ts', {
            '@supabase/ssr': { createServerClient: () => auth }, '@supabase/supabase-js': {},
            'next/headers': { cookies: async () => ({ getAll: () => [] }) }, 'next/server': {},
        }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'url', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' } } })
        if (scenario === 'admin') await server.staff()
        else await assert.rejects(server.staff(), error => error.status === (scenario === 'anonymous' ? 401 : 403))
    }
})
test('manual sync rejects foreign origins before invoking authorization or collection', async () => {
    let calls = 0
    class SocialError extends Error { constructor(message, status) { super(message); this.status = status } }
    const route = load('app/api/admin/acquisition/route.ts', {
        'next/server': {}, '@/lib/social/providers': {}, '@/lib/social/metrics': {},
        '@/lib/social/server': { SocialError, staff: () => { calls++ }, failure: error => ({ status: error.status }) },
        '@/lib/social/sync': { sync: () => { calls++ } },
    })
    const result = await route.POST({ url: 'https://admin.example/api/admin/acquisition', headers: new Headers({ origin: 'https://foreign.example' }) })
    assert.equal(result.status, 403); assert.equal(calls, 0)
})

function databaseModule(env, calls = []) {
    return load('lib/social/server.ts', {
        '@supabase/ssr': {}, 'next/headers': {}, 'next/server': {},
        '@supabase/supabase-js': { createClient: (url, key) => { calls.push({ url, key }); return { url, key } } },
    }, { process: { env } })
}
const splitEnv = { NEXT_PUBLIC_SUPABASE_URL: 'https://app.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'app-key',
    MARKETING_SUPABASE_URL: 'https://marketing.supabase.co', MARKETING_SUPABASE_SERVICE_ROLE_KEY: 'marketing-key', MARKETING_APP_ID: 'daily-hanzi' }
test('marketing uses dedicated credentials; missing config and the app project fail closed', () => {
    const calls = []
    const server = databaseModule(splitEnv, calls)
    assert.equal(server.database().url, splitEnv.MARKETING_SUPABASE_URL)
    assert.equal(server.appDatabase().url, splitEnv.NEXT_PUBLIC_SUPABASE_URL)
    assert.equal(calls[0].key, 'marketing-key'); assert.equal(calls[1].key, 'app-key')
    for (const overrides of [
        { MARKETING_SUPABASE_URL: '' }, { MARKETING_SUPABASE_SERVICE_ROLE_KEY: '' },
        { MARKETING_SUPABASE_URL: 'https://app.supabase.co/' }, { MARKETING_APP_ID: '' }, { MARKETING_APP_ID: 'invalid id' },
    ]) {
        const rejectedCalls = []
        assert.throws(() => databaseModule({ ...splitEnv, ...overrides }, rejectedCalls).database(), error => error.status === 503)
        assert.equal(rejectedCalls.length, 0)
    }
})
function signupFixture(batches) {
    const writes = [], reads = []
    const app = { from: table => {
        assert.equal(table, 'profiles')
        const q = { select: fields => { reads.push(fields); return q }, eq: () => q, gte: () => q, lt: () => q, order: () => q,
            range: async () => batches.shift() }
        return q
    } }
    const marketing = { rpc: async (name, payload) => { writes.push({ name, payload }); return {} } }
    const signups = load('lib/social/signups.ts', { './server': { appId: () => 'daily-hanzi', appDatabase: () => app } })
    return { ...signups, marketing, writes, reads }
}
test('signup sync writes only per-app daily counts, with zero days and fixed referral categories', async () => {
    const fixture = signupFixture([{ data: [
        { created_at: '2026-11-04T23:59:00Z', referral_source: 'Instagram Reel' },
        { created_at: '2026-11-05T00:00:00Z', referral_source: 'Tik Tok' },
        { created_at: '2026-11-05T00:00:01Z', referral_source: 'private free-text answer with an email' },
        { created_at: '2026-11-05T01:00:00Z', referral_source: null },
    ] }])
    assert.equal(await fixture.syncSignups(fixture.marketing, new Date('2026-11-05T02:00:00Z')), 90)
    const { name, payload } = fixture.writes[0]
    assert.equal(name, 'save_marketing_signup_days')
    assert.equal(payload.rows.length, 90)
    assert.equal(payload.rows[0].signups, 0)
    assert.equal(payload.rows[88].instagram_referrals, 1)
    assert.equal(payload.rows[89].signups, 3)
    assert.equal(payload.rows[89].tiktok_referrals, 1)
    assert.equal(payload.rows[89].other_referrals, 1)
    assert.equal(payload.rows[89].unknown_referrals, 1)
    assert.ok(payload.rows.every(row => row.app_id === 'daily-hanzi'))
    assert.ok(!JSON.stringify(payload).includes('private free-text'))
    assert.ok(!fixture.reads[0].includes('email'))
})
test('signup pagination failures preserve prior marketing aggregates', async () => {
    const fixture = signupFixture([{ data: Array.from({ length: 1000 }, () => ({ created_at: '2026-11-05T00:00:00Z', referral_source: 'Instagram' })) },
        { data: null, error: { message: 'database unavailable' } }])
    await assert.rejects(fixture.syncSignups(fixture.marketing), /existing marketing aggregates were preserved/)
    assert.equal(fixture.writes.length, 0)
})
test('dashboard reads only app-scoped marketing tables and preserves missing-day gaps', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const reads = [], scopes = []
    const db = { from: table => {
        reads.push(table)
        const result = { data: table === 'marketing_signup_days' ? [{ day: today, signups: 2, instagram_referrals: 1,
            tiktok_referrals: 0, other_referrals: 0, unknown_referrals: 1, collected_at: new Date().toISOString() }] : [] }
        const q = { then: resolve => Promise.resolve(result).then(resolve) }
        for (const method of ['select', 'gte', 'lte', 'order', 'range', 'limit']) q[method] = () => q
        q.eq = (field, value) => { scopes.push([table, field, value]); return q }
        return q
    } }
    const route = load('app/api/admin/acquisition/route.ts', {
        'next/server': { NextResponse: { json: body => body } }, '@/lib/social/providers': { accounts: () => [] },
        '@/lib/social/metrics': metrics, '@/lib/social/sync': {},
        '@/lib/social/server': { database: () => db, appId: () => 'daily-hanzi', staff: async () => {}, failure: error => { throw error } },
    })
    const report = await route.GET({ url: 'https://admin.example/api/admin/acquisition?days=7' })
    assert.equal(reads.join(','), 'social_snapshots,marketing_signup_days,social_sync_runs')
    assert.equal(scopes.length, 3)
    assert.ok(scopes.every(([, field, value]) => field === 'app_id' && value === 'daily-hanzi'))
    assert.equal(report.daily[0].signups, null)
    assert.equal(report.daily[6].signups, 2)
    assert.equal(report.signupCoverage.measuredDays, 1)
})

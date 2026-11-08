const { test } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
function load(file, mocks = {}, globals = {}) {
    const module = { exports: {} }, source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(source, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), URL, URLSearchParams, AbortSignal, Date, process: { env: {} }, ...globals })
    return module.exports
}
const metrics = load('lib/social/metrics.ts')
const moduleFor = globals => load('lib/social/instagram-days.ts', { './metrics': metrics, './server': { appId: () => 'daily-hanzi' } }, globals)
const api = moduleFor()
function payload(total, entries) {
    return { data: [{ name: 'views', total_value: { value: total, breakdowns: [{ dimension_keys: ['media_product_type'],
        results: entries.map(([name, value]) => ({ dimension_values: [name], value })) }] } }] }
}
test('organic daily views exclude AD from the same reconciled account metric', () => {
    const row = api.parseInstagramViews(payload(189680, [['POST', 120], ['AD', 180238], ['CAROUSEL_CONTAINER', 4494], ['REEL', 4358], ['STORY', 470]]))
    assert.equal(row.organic_views, 9442); assert.equal(row.ad_views, 180238); assert.equal(row.status, 'complete')
})
test('zero is accepted only from an explicit reconciled zero total', () => {
    assert.equal(api.parseInstagramViews(payload(0, [])).organic_views, 0)
    assert.equal(api.parseInstagramViews({ data: [] }).organic_views, null)
    assert.equal(api.parseInstagramViews({ data: [{ name: 'views', total_value: { value: 10 } }] }).organic_views, null)
})
test('unknown, duplicated, negative and non-reconciling categories never become organic counts', () => {
    for (const body of [payload(10, [['AD', 8], ['POST', 1]]), payload(10, [['UNKNOWN', 10]]), payload(10, [['POST', 5], ['POST', 5]]),
        payload(10, [['AD', -1], ['POST', 11]]), payload(10, [['POST', '10']]), payload(10, [['POST', 10.5]])]) {
        assert.equal(api.parseInstagramViews(body).organic_views, null)
    }
})
test('non-ad-only categories can prove a zero-ad day when the total reconciles', () => {
    const row = api.parseInstagramViews(payload(20, [['REEL', 10], ['STORY', 10]]))
    assert.equal(row.organic_views, 20); assert.equal(row.ad_views, 0)
})
test('multi-account totals require every configured account and never substitute post snapshots', () => {
    const row = { day: '2026-11-05', account_id: 'a', organic_views: 10, ad_views: 5, total_views: 15, status: 'complete' }
    assert.equal(api.aggregateInstagramDays([row], ['a'], ['2026-11-05'])[0].organic, 10)
    assert.equal(api.aggregateInstagramDays([row], ['a', 'b'], ['2026-11-05'])[0].organic, null)
    assert.equal(api.aggregateInstagramDays([{ ...row, status: 'unverified' }], ['a'], ['2026-11-05'])[0].organic, null)
    assert.equal(api.aggregateInstagramDays([row], [], ['2026-11-05'])[0].organic, null)
    assert.equal(api.aggregateInstagramDays([row], ['a'], ['2026-11-04'])[0].organic, null)
})
function syncFixture({ existing = [], fail = false } = {}) {
    const calls = [], writes = []
    const q = { eq: () => q, gte: () => q, lte: async () => ({ data: existing.map(day => typeof day === 'string' ? { day, status: 'complete' } : day) }) }
    const db = { from: () => ({ select: () => q }), rpc: async (name, body) => { writes.push({ name, ...body }); return {} } }
    const mod = moduleFor({ fetch: async (url, init) => { calls.push({ url: String(url), init }); return { ok: !fail, status: fail ? 403 : 200,
        json: async () => fail ? { error: { code: 10, message: 'private-token' } } : payload(10, [['AD', 7], ['POST', 3]]) } } })
    return { ...mod, db, calls, writes }
}
const account = { platform: 'instagram', accountId: '123', label: 'Test', accessToken: 'private-token' }
test('backfill requests separate completed UTC days with an AD-capable breakdown', async () => {
    const f = syncFixture()
    assert.equal(await f.syncInstagramDays(account, f.db, new Date('2026-11-06T12:00:00Z'), 4), 3)
    assert.equal(f.writes[0].name, 'save_instagram_account_days')
    assert.equal(f.writes[0].rows.map(r => r.day).join(','), '2026-11-03,2026-11-04,2026-11-05')
    for (const call of f.calls) {
        const url = new URL(call.url)
        assert.equal(url.searchParams.get('breakdown'), 'media_product_type'); assert.equal(url.searchParams.get('metric'), 'views')
        assert.equal(Number(url.searchParams.get('until')) - Number(url.searchParams.get('since')), 86399)
        assert.equal(call.init.headers.Authorization, 'Bearer private-token'); assert.ok(!call.url.includes('private-token'))
    }
})
test('older saved days are reused while the latest three days are refreshed', async () => {
    const f = syncFixture({ existing: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'] })
    assert.equal(await f.syncInstagramDays(account, f.db, new Date('2026-11-06T12:00:00Z'), 5), 3)
    assert.equal(f.calls.length, 3)
})
test('provider failures preserve prior daily history and never expose provider tokens', async () => {
    const f = syncFixture({ fail: true })
    await assert.rejects(f.syncInstagramDays(account, f.db, new Date('2026-11-06T12:00:00Z'), 3), error => {
        assert.ok(!error.message.includes('private-token')); return true
    })
    assert.equal(f.writes.length, 0)
})

test('carousel-slide views are organic and reconcile the previously missing November dates', () => {
    const first = api.parseInstagramViews(payload(286642, [['REEL', 5072], ['CAROUSEL_ITEM', 1], ['STORY', 819], ['CAROUSEL_CONTAINER', 9644], ['AD', 270303], ['POST', 803]]))
    assert.equal(first.status, 'complete'); assert.equal(first.organic_views, 16339)
    const fourth = api.parseInstagramViews(payload(197648, [['CAROUSEL_ITEM', 3], ['STORY', 292], ['POST', 195], ['CAROUSEL_CONTAINER', 5902], ['REEL', 2453], ['AD', 188803]]))
    assert.equal(fourth.status, 'complete'); assert.equal(fourth.organic_views, 8845)
})
test('unverified or unavailable older dates are retried instead of remaining permanent gaps', async () => {
    for (const status of ['unverified', 'unavailable']) {
        const f = syncFixture({ existing: [{ day: '2026-11-02', status }, '2026-11-03', '2026-11-04', '2026-11-05'] })
        assert.equal(await f.syncInstagramDays(account, f.db, new Date('2026-11-06T12:00:00Z'), 5), 4)
        assert.equal(f.writes[0].rows[0].day, '2026-11-02')
    }
})

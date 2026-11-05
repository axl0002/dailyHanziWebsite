const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
function load(file, mocks = {}, globals = {}) {
    const module = { exports: {} }
    const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
    vm.runInNewContext(source, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), URL, URLSearchParams, AbortSignal, Buffer, Date, process: { env: {} }, ...globals })
    return module.exports
}
class SocialError extends Error { constructor(message, status = 400) { super(message); this.status = status } }
const env = { INSTAGRAM_META_APP_ID: '123', INSTAGRAM_META_APP_SECRET: 'private-secret', INSTAGRAM_LOGIN_CONFIG_ID: '456',
    INSTAGRAM_REDIRECT_URI: 'https://dailyhanzi.app/api/admin/instagram/callback', SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') }
function authFixture(responses = [], overrides = {}) {
    const calls = [], writes = []
    const server = { SocialError, appId: () => 'daily-hanzi' }
    const module = load('lib/social/instagram-auth.ts', { './server': server }, { process: { env: { ...env, ...overrides } }, fetch: async (url, init) => {
        calls.push({ url: String(url), init }); const body = responses.shift()
        if (!body) throw new Error('Unexpected call')
        return { ok: !body.error, json: async () => body }
    } })
    const db = { from: table => ({ upsert: async (rows, options) => { writes.push({ table, rows, options }); return {} },
        select: () => ({ eq: async (_field, value) => { assert.equal(value, 'daily-hanzi'); return { data: [] } } }) }) }
    return { ...module, calls, writes, db }
}
test('Unified Login uses config_id and state with an allowlisted HTTPS redirect', () => {
    const f = authFixture(), url = f.loginUrl('state')
    assert.equal(url.origin, 'https://www.facebook.com')
    assert.equal(url.searchParams.get('config_id'), '456'); assert.equal(url.searchParams.get('state'), 'state')
    assert.equal(url.searchParams.get('override_default_response_type'), 'true');
    assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.has('scope'), false)
    assert.ok(!String(url).includes('private-secret'))
    assert.throws(() => authFixture([], { INSTAGRAM_REDIRECT_URI: 'http://evil.test/callback' }).loginUrl('state'))
})
test('tokens are encrypted with randomized IVs and authenticated to the account', () => {
    const f = authFixture(), first = f.encryptToken('private-token', '1'), second = f.encryptToken('private-token', '1')
    assert.notEqual(first, second); assert.ok(!first.includes('private-token')); assert.equal(f.decryptToken(first, '1'), 'private-token')
    assert.throws(() => f.decryptToken(first, '2'), /cannot be decrypted/)
    assert.throws(() => f.decryptToken(first.slice(0, -5) + 'aaaaa', '1'), /cannot be decrypted/)
})
test('code exchange discovers all assigned accounts without using Page discovery or provider next URLs', async () => {
    const f = authFixture([{ access_token: 'private-token' },
        { data: [{ id: '1', username: 'hanzi' }], paging: { next: 'https://evil.test/leak', cursors: { after: 'next' } } },
        { data: [{ id: '2', username: 'hanzi2' }] }, { data: [] }, { data: [] }])
    assert.equal(await f.authorizeInstagram('one-time-code', f.db), 2)
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].rows.length, 2)
    assert.ok(f.calls.every(c => new URL(c.url).hostname === 'graph.facebook.com'))
    assert.ok(f.calls[1].url.includes('/me/assigned_instagram_accounts'))
    assert.equal(f.calls[1].init.headers.Authorization, 'Bearer private-token')
    assert.ok(!f.calls[1].url.includes('private-token'))
    assert.ok(!JSON.stringify(f.writes).includes('private-token'))
    assert.equal(f.decryptToken(f.writes[0].rows[0].encrypted_access_token, '1'), 'private-token')
})
test('missing account grant or missing insights access never persists a connection', async () => {
    for (const responses of [[{ access_token: 'private-token' }, { data: [] }],
        [{ access_token: 'private-token' }, { data: [{ id: '1', username: 'hanzi' }] }, { error: { message: 'private-token' } }]]) {
        const f = authFixture(responses)
        await assert.rejects(f.authorizeInstagram('code', f.db), e => !e.message.includes('private-token'))
        assert.equal(f.writes.length, 0)
    }
})
test('database connections override duplicate manual Instagram entries while preserving TikTok', async () => {
    const f = authFixture(), token = f.encryptToken('stored-token', '1')
    const db = { from: () => ({ select: () => ({ eq: async () => ({ data: [{ account_id: '1', username: 'hanzi', encrypted_access_token: token }] }) }) }) }
    const rows = await f.connectedAccounts(db, [{ platform: 'instagram', accountId: '1', accessToken: 'old' }, { platform: 'tiktok', accountId: '2', accessToken: 'tt' }])
    assert.equal(rows.length, 2); assert.equal(rows.find(a => a.platform === 'instagram').accessToken, 'stored-token')
    assert.equal(rows.find(a => a.platform === 'tiktok').accessToken, 'tt')
})
function callbackFixture({ expected, state, denied = false, forbidden = false } = {}) {
    let authorizations = 0, cleared = false
    const cookie = { get: () => expected ? { value: expected } : undefined, set: (_key, _value, options) => { cleared = options.maxAge === 0 } }
    const module = load('app/api/admin/instagram/callback/route.ts', {
        '@/lib/social/instagram-attempts': { updateAttempt: async () => {} },
        'next/headers': { cookies: async () => cookie }, 'next/server': { NextResponse: { redirect: url => url } },
        '@/lib/social/server': { SocialError, staff: async () => { if (forbidden) throw new SocialError('Forbidden', 403) }, database: () => ({}) },
        '@/lib/social/instagram-auth': { instagramStateCookie: 'state', instagramConfig: () => ({ redirectUri: env.INSTAGRAM_REDIRECT_URI }),
            authorizeInstagram: async () => { authorizations++; return 1 } },
    })
    return { ...module, request: { url: `${env.INSTAGRAM_REDIRECT_URI}?state=${state || ''}&code=code${denied ? '&error=access_denied' : ''}` },
        count: () => authorizations, cleared: () => cleared }
}
test('callback rejects missing or mismatched state, provider denial and non-admin callers', async () => {
    const state = 'a'.repeat(64)
    for (const options of [{ state }, { expected: state, state: 'b'.repeat(64) }, { expected: state, state, denied: true }, { expected: state, state, forbidden: true }]) {
        const f = callbackFixture(options), url = await f.GET(f.request)
        assert.ok(url.searchParams.has('instagram_error')); assert.equal(f.count(), 0); assert.ok(f.cleared())
    }
})
test('verified callback clears state and redirects without code or token', async () => {
    const state = 'a'.repeat(64), f = callbackFixture({ expected: state, state }), url = await f.GET(f.request)
    assert.equal(f.count(), 1); assert.ok(f.cleared()); assert.equal(url.searchParams.get('instagram_connected'), '1')
    assert.equal(url.pathname, '/admin/acquisition'); assert.ok(!String(url).includes('code='))
})

test('Meta diagnostics retain safe error codes and stage without provider secrets', async () => {
    const f = authFixture([{ error: { code: 190, error_subcode: 123, message: 'private-token private-secret one-time-code' } }])
    await assert.rejects(f.authorizeInstagram('one-time-code', f.db), error => {
        assert.match(error.message, /code exchange/); assert.match(error.message, /code 190/); assert.match(error.message, /subcode 123/)
        assert.ok(!error.message.includes('private-token')); assert.ok(!error.message.includes('private-secret')); assert.ok(!error.message.includes('one-time-code'))
        return true
    })
})
test('connection progress identifies the failure stage before any credential persistence', async () => {
    const f = authFixture([{ access_token: 'private-token' }, { data: [] }]), stages = []
    await assert.rejects(f.authorizeInstagram('code', f.db, async stage => stages.push(stage)), /No Instagram account/)
    assert.equal(stages.join(','), 'code_exchange,account_discovery'); assert.equal(f.writes.length, 0)
})
test('OAuth attempt IDs hash state and do not store codes or tokens', async () => {
    const rows = [], writes = []
    const f = load('lib/social/instagram-attempts.ts', { './server': { SocialError, appId: () => 'daily-hanzi' } })
    const db = { from: () => ({ insert: async row => { rows.push(row); return {} },
        update: value => { writes.push(value); return { eq: () => ({ eq: async () => ({}) }) } } }) }
    await f.beginAttempt(db, 'private-state'); await f.updateAttempt(db, 'private-state', 'code_exchange')
    assert.equal(rows[0].id.length, 64); assert.equal(rows[0].status, 'started')
    assert.ok(!JSON.stringify(rows).includes('private-state')); assert.equal(writes[0].stage, 'code_exchange')
})

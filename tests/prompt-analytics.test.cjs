const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}) {
    const mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
        { exports: mod.exports, require: name => mocks[name] ?? require(name), process: { env: {} }, URL, Date });
    return mod.exports;
}
const analytics = load('../lib/promptAnalytics.ts');
test('rates weight assignments instead of averaging daily percentages and preserve no-assignment gaps', () => {
    const row = { prompt_id: 'a', title: 'A', slug: 'a', response_type: 'voice' };
    const result = analytics.summarizePrompts([
        { ...row, date: '2026-11-14', assigned: 1, responded: 1 },
        { ...row, date: '2026-11-15', assigned: 9, responded: 0 },
    ], ['2026-11-14','2026-11-15','2026-11-16']);
    assert.equal(result.rate, 10); assert.equal(result.prompts[0].rate, 10);
    assert.equal(result.daily[1].counts.voice.rate, 0);
    assert.equal(result.daily[2].counts.voice.rate, null);
    assert.equal(result.responded, 1); assert.equal(result.assigned, 10);
});
test('prompt identity and response types remain separate', () => {
    const result = analytics.summarizePrompts([
        { prompt_id: 'a', title: 'Same', slug: 'a', response_type: 'voice', date: '2026-11-16', assigned: 10, responded: 3 },
        { prompt_id: 'b', title: 'Same', slug: 'b', response_type: 'photo', date: '2026-11-16', assigned: 20, responded: 4 },
    ], ['2026-11-16']);
    assert.equal(result.prompts.length, 2); assert.equal(result.responded, 7);
    assert.equal(result.daily[0].counts.voice.rate, 30); assert.equal(result.daily[0].counts.photo.rate, 20);
});
function routeFixture({ anonymous = false, forbidden = false, rpcError = false } = {}) {
    const calls = [];
    const auth = { auth: { getUser: async () => ({ data: { user: anonymous ? null : { id: 'staff' } } }) },
        from: () => { const q = { select: () => q, eq: () => q, in: async () => ({ data: forbidden ? [] : [{ role: 'moderator' }] }) }; return q; },
        rpc: async (name, args) => { calls.push({ name, args }); return { data: [], error: rpcError ? {} : null }; },
    };
    const route = load('../app/api/admin/daily-prompts/analytics/route.ts', {
        'next/server': { NextResponse: { json: (body, init) => ({ body, ...init }) } },
        '@supabase/ssr': { createServerClient: () => auth },
        'next/headers': { cookies: async () => ({ getAll: () => [] }) },
        '@/lib/promptAnalytics': analytics,
    });
    return { ...route, calls };
}
test('analytics denies unsigned/nonstaff users and invalid filters before the aggregate RPC', async () => {
    for (const [options, query, status] of [[{ anonymous: true }, '', 401], [{ forbidden: true }, '', 403], [{}, '?days=10000', 400], [{}, '?type=invalid', 400]]) {
        const f = routeFixture(options);
        assert.equal((await f.GET({ url: 'https://example.test/api'+query })).status, status);
        assert.equal(f.calls.length, 0);
    }
});
test('analytics queries bounded dates and exact type using the authenticated client', async () => {
    const f = routeFixture(); const result = await f.GET({ url: 'https://example.test/api?days=14&type=voice' });
    assert.equal(f.calls[0].name, 'admin_daily_prompt_analytics');
    assert.equal(f.calls[0].args.p_type, 'voice');
    const span = (new Date(f.calls[0].args.p_end)-new Date(f.calls[0].args.p_start))/86400000;
    assert.equal(span, 13); assert.equal(result.headers['Cache-Control'], 'private, no-store');
    assert.equal((await routeFixture({ rpcError: true }).GET({ url: 'https://example.test/api' })).status, 500);
});

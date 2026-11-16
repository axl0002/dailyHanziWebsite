const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function fixture({ anonymous = false, forbidden = false, roleError = false, queryError = false, pages = [[{ id: 'prompt', active: false }]] } = {}) {
    const calls = [];
    const auth = { auth: { getUser: async () => ({ data: { user: anonymous ? null : { id: 'staff' } } }) },
        from: table => { assert.equal(table, 'user_roles'); const chain = { select: () => chain, eq: (key, value) => { assert.equal(key, 'user_id'); assert.equal(value, 'staff'); return chain; }, in: async () => ({ data: forbidden ? [] : [{ role: 'moderator' }], error: roleError ? {} : null }) }; return chain; } };
    const db = { from: table => { assert.equal(table, 'social_prompts'); const chain = {
        select: () => chain, order: () => chain, range: async (from, to) => { calls.push({ from, to }); return { data: pages[from / 1000] ?? [], error: queryError ? { message: 'private DB detail' } : null }; },
    }; return chain; } };
    const mocks = {
        'next/server': { NextResponse: { json: (body, init) => ({ body, ...init }) } },
        '@supabase/ssr': { createServerClient: () => auth },
        '@supabase/supabase-js': { createClient: () => db },
        'next/headers': { cookies: async () => ({ getAll: () => [] }) },
    };
    const mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../app/api/admin/daily-prompts/route.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
        { exports: mod.exports, require: name => mocks[name] ?? require(name), process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'server-key' } } });
    return { GET: mod.exports.GET, calls };
}
test('prompt reads reject unauthenticated, nonstaff and failed role checks before accessing content', async () => {
    for (const [options, status] of [[{ anonymous: true }, 401], [{ forbidden: true }, 403], [{ roleError: true }, 403]]) {
        const f = fixture(options); assert.equal((await f.GET()).status, status); assert.equal(f.calls.length, 0);
    }
});
test('staff can view inactive prompts and all pages beyond the Supabase row limit', async () => {
    const f = fixture({ pages: [Array.from({ length: 1000 }, (_, id) => ({ id })), [{ id: 'inactive', active: false }]] });
    const result = await f.GET(); assert.equal(result.body.prompts.length, 1001);
    assert.equal(result.body.prompts[1000].active, false); assert.equal(f.calls[1].from, 1000);
    assert.equal(result.headers['Cache-Control'], 'private, no-store');
});
test('query errors return no partial results or database details', async () => {
    const result = await fixture({ queryError: true }).GET();
    assert.equal(result.status, 500); assert.equal(result.body.prompts, undefined);
    assert.ok(!JSON.stringify(result.body).includes('private DB detail'));
});

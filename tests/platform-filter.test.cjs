const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
function load(relative, mocks = {}) {
    const mod = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText,
        { exports: mod.exports, require: name => name in mocks ? mocks[name] : require(name), console, Date });
    return mod.exports;
}
const filter = load('../lib/platformFilter.ts');
test('client filtering preserves unknowns in Both and separates profile platforms and purchase stores', () => {
    const rows = [{ platform: 'ios' }, { platform: 'android' }, { platform: null }];
    assert.equal(filter.filterPlatformRows(rows, 'all').length, 3);
    assert.equal(filter.filterPlatformRows(rows, 'ios')[0], rows[0]);
    assert.equal(filter.filterPlatformRows(rows, 'android')[0], rows[1]);
    const events = [{ store: 'APP_STORE' }, { store: 'PLAY_STORE' }, { store: 'STRIPE' }];
    assert.equal(filter.filterPlatformRows(events, 'ios')[0], events[0]);
    assert.equal(filter.filterPlatformRows(events, 'android')[0], events[1]);
});
function harness() {
    let cursor = 0;
    const cells = [], pending = [];
    const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
    const react = {
        useState: initial => { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }]; },
        useEffect: (fn, deps) => { const i = cursor++; if (!same(cells[i], deps)) { cells[i] = deps; pending.push(fn); } },
        useCallback: (fn, deps) => { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) cells[i] = { fn, deps }; return cells[i].fn; },
        useMemo: (fn, deps) => { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) cells[i] = { value: fn(), deps }; return cells[i].value; },
        createContext: () => ({ Provider: 'provider' }),
        useContext: () => ({ platform: currentPlatform }),
    };
    let currentPlatform = 'all';
    return { react, platform: () => currentPlatform, setPlatform: value => { currentPlatform = value; },
        render: fn => { cursor = 0; return fn(); },
        flush: async () => { for (const fn of pending.splice(0)) fn(); await new Promise(resolve => setImmediate(resolve)); },
    };
}
test('changing platforms selects preloaded chart state without changing the stable setter', () => {
    const h = harness();
    const module = load('../app/admin/components/PlatformFilter.tsx', { react: h.react, '@/lib/platformFilter': filter });
    const render = () => h.render(() => module.usePlatformState(0));
    const [, set] = render(); set(100, 'all'); set(70, 'ios'); set(20, 'android');
    assert.equal(render()[0], 100);
    h.setPlatform('ios'); assert.equal(render()[0], 70); assert.equal(render()[1], set);
    h.setPlatform('android'); assert.equal(render()[0], 20); assert.equal(render()[1], set);
});
test('RPC charts fetch all platform slices once; toggling makes no additional requests', async () => {
    const h = harness(); let calls = 0;
    const mod = load('../app/admin/components/useRpcData.ts', { react: h.react,
        './PlatformFilter': { usePlatformFilter: h.platform },
        '@/lib/supabase': { supabase: { rpc: async name => { calls++; assert.equal(name, 'widget_tap_stats_platforms'); return { data: { all: [{ n: 100 }], ios: [{ n: 70 }], android: [{ n: 20 }] } }; } } },
    });
    const render = () => h.render(() => mod.useRpcData('widget_tap_stats', { since_date: null }, row => row));
    render(); await h.flush(); assert.equal(render().data[0].n, 100);
    h.setPlatform('ios'); assert.equal(render().data[0].n, 70); await h.flush();
    h.setPlatform('android'); assert.equal(render().data[0].n, 20); await h.flush();
    assert.equal(calls, 1);
});
test('shared profile distributions switch locally without re-fetching', async () => {
    const h = harness(); let calls = 0;
    const mod = load('../app/admin/components/useProfilesCache.tsx', { react: h.react,
        './PlatformFilter': { usePlatformFilter: h.platform }, './useRpcData': { sinceFromDateRange: () => null },
        '@/lib/supabase': { supabase: { rpc: async name => { calls++; assert.equal(name, 'profile_distributions_platforms'); return { data: { all: { pool: { total: 100 } }, ios: { pool: { total: 70 } }, android: { pool: { total: 20 } } } }; } } },
    });
    const render = () => h.render(() => mod.ProfilesCacheProvider({ dateRange: 'all', children: null })).props.value;
    render(); await h.flush(); assert.equal(render().distributions.pool.total, 100);
    h.setPlatform('ios'); assert.equal(render().distributions.pool.total, 70); await h.flush();
    h.setPlatform('android'); assert.equal(render().distributions.pool.total, 20); await h.flush();
    assert.equal(calls, 1);
});

for (const chart of ['UserGrowthChart','HourlyGrowthChart','ReferralByDayChart','PlatformByDayChart','TimezoneByDayChart','ProUserPercentageChart','CancellationByDayChart','HourlyCancellationChart','TrialCancellationChart','TrialCancellationRateOverTimeChart']) {
    test(`${chart} keeps its fetched rows when the platform changes`, async () => {
        const h = harness(); let requests = 0;
        const platformModule = load('../app/admin/components/PlatformFilter.tsx', { react: h.react, '@/lib/platformFilter': filter });
        const rows = ['ios','android'].map(platform => ({ id: platform, platform, store: platform === 'ios' ? 'APP_STORE' : 'PLAY_STORE', created_at: new Date().toISOString(), event_timestamp: new Date().toISOString(), is_pro: true, timezone: 'Asia/Tokyo', product_id: 'trial_3day', survey_responses: {}, raw: { purchased_at_ms: Date.now()-9*86400000, expiration_at_ms: Date.now()-6*86400000 } }));
        const supabase = { from: () => {
            const q = { then: (resolve, reject) => { requests++; return Promise.resolve({ data: rows }).then(resolve, reject); } };
            for (const method of ['select','eq','gte','lte','lt','order','range','limit']) q[method] = () => q;
            return q;
        } };
        const empty = () => null;
        const module = load(`../app/admin/components/${chart}.tsx`, { react: h.react,
            './PlatformFilter': platformModule, '@/lib/platformFilter': filter, '@/lib/supabase': { supabase },
            './DateLabelModal': empty, './ClickableXAxisTick': empty, './PaywallCountryChart': empty,
            './StackedReferenceLabel': { default: empty, assignLabelRows: () => [], topMarginForLabelRows: () => 10 },
            '@/lib/paywallCountries': load('../lib/paywallCountries.ts'),
            '@/lib/timezoneToCountry': load('../lib/timezoneToCountry.ts'),
        });
        const render = () => h.render(() => module.default({ dateLabels: {}, onAddLabel: async () => {}, onDeleteLabel: async () => {} }));
        render(); await h.flush(); render(); await h.flush(); const initialRequests = requests;
        assert.ok(initialRequests > 0);
        h.setPlatform('ios'); render(); await h.flush();
        h.setPlatform('android'); render(); await h.flush();
        h.setPlatform('all'); render(); await h.flush();
        assert.equal(requests, initialRequests);
    });
}

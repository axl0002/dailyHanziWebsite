const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../lib/paywallCountries.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: moduleUnderTest.exports, require });
const { paywallCountries } = moduleUnderTest.exports;
const profile = (timezone, is_pro, date = '2026-11-12') => ({ timezone, is_pro, created_at: `${date}T12:00:00Z` });
test('groups timezones into countries and computes daily Pro share with empty days as gaps', () => {
    const result = paywallCountries([profile('America/New_York', true), profile('America/Los_Angeles', false), profile('Asia/Tokyo', false)], ['2026-11-11', '2026-11-12']);
    assert.equal(result.countries[0], 'United States of America');
    const us = result.countries[0];
    assert.equal(result.data[1].rates[us], 50);
    assert.equal(result.data[1].counts[us].total, 2);
    assert.equal(result.data[0].rates[us], null);
    assert.equal(result.data[1].rates.Japan, 0);
});
test('selects only seven countries by visible signup volume, excluding unknown and outside-window data', () => {
    const zones = ['Asia/Tokyo', 'Asia/Seoul', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Singapore', 'Asia/Kolkata', 'Australia/Sydney'];
    const profiles = zones.flatMap((zone, i) => Array.from({ length: i + 1 }, () => profile(zone, false)));
    profiles.push(profile(null, true), profile('bad/timezone', true), ...Array.from({ length: 30 }, () => profile('Asia/Tokyo', true, '2020-01-01')));
    const result = paywallCountries(profiles, ['2026-11-12']);
    assert.equal(result.countries.length, 7);
    assert.equal(result.countries[0], 'Australia');
    assert.ok(!result.countries.includes('Japan'));
});

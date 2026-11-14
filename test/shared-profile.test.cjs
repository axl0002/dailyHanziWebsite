const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, name => load(path.resolve(path.dirname(file), name + '.ts')));
  return exports;
}

const code = '0123456789abcdef0123456789abcdef';
const route = load('app/add/[code]/route.ts');
const landing = c => route.GET(new Request('https://dailyhanzi.app/add/' + code),
  { params: Promise.resolve({ code: c }) });

test('browser fallback opens the same profile, offers both stores and keeps no cache', async () => {
  const response = await landing(code);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const html = await response.text();
  assert.ok(html.includes('href="dailyhanzi://dailyhanzi.com/add/' + code + '"'));
  assert.ok(html.includes('https://apps.apple.com/app/daily-hanzi/id6756919959'));
  assert.ok(html.includes('https://play.google.com/store/apps/details?id=com.alexliu.dailyhanzi'));
});

test('malformed codes cannot inject markup or a custom destination', async () => {
  const response = await landing('"><script>test</script>');
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Profile link not found.');
});

test('iOS association is JSON and only matches profile paths', async () => {
  const response = load('app/.well-known/apple-app-site-association/route.ts').GET();
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { applinks: { details: [{
    appIDs: ['MK29ZT8FZ7.com.alexliu.dailyhanzi'], components: [{ '/': '/add/*' }],
  }] } });
});

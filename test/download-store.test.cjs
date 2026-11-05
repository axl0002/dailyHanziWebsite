const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if(cache.has(file)) return cache.get(file);
  const module = {exports:{}}; cache.set(file,module.exports);
  const js = ts.transpileModule(fs.readFileSync(file,'utf8'),
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  new Function('exports','require','module',js)(module.exports,
    (name)=>load(path.resolve(path.dirname(file),name+'.ts')),module);
  return module.exports;
}
const {appleStoreUrl,googlePlayUrl} = load('lib/download-store.ts');
const {GET} = load('app/download/route.ts');
for(const [device,ua,expected] of [
  ['iPhone','Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile',appleStoreUrl],
  ['iPad','Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)',appleStoreUrl],
  ['iPad mobile desktop UA','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148',appleStoreUrl],
  ['Android','Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36',googlePlayUrl],
]) test(device+' goes directly to the correct store without caching',()=>{
  const r=GET(new Request('https://dailyhanzi.app/download',{headers:{'user-agent':ua}}));
  assert.equal(r.status,302);assert.equal(r.headers.get('location'),expected);
  assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('vary'),'User-Agent');
});
for(const [device,ua] of [['desktop','Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'],['unknown',''],['preview crawler','WhatsApp/2.24']])
  test(device+' gets an accessible page with both download options',async()=>{
    const r=GET(new Request('https://dailyhanzi.app/download',{headers:{'user-agent':ua}}));
    assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);
    const html=await r.text();assert.ok(html.includes(appleStoreUrl));assert.ok(html.includes(googlePlayUrl));
    assert.ok(html.includes('og:title'));assert.ok(html.includes('navigator.maxTouchPoints>1'));
  });
test('query parameters cannot redirect to an arbitrary destination',()=>{
  const r=GET(new Request('https://dailyhanzi.app/download?url=https://evil.example',{headers:{'user-agent':'iPhone'}}));
  assert.equal(r.headers.get('location'),appleStoreUrl);
});

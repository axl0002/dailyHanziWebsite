import { appleStoreUrl, googlePlayUrl } from '../../../lib/download-store';

const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (code.length !== 32 || !/^[a-f0-9]+$/.test(code)) {
    return new Response('Profile link not found.', {
      status: 404, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Native app links usually skip this page. Use a user-initiated custom
  // scheme for browsers that display the landing page instead.
  const openApp = `dailyhanzi://dailyhanzi.com/add/${code}`;
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect on Daily Hanzi</title>
<meta name="description" content="Open Daily Hanzi to find your friend and send a request.">
<meta property="og:title" content="Connect on Daily Hanzi">
<meta property="og:description" content="Learn Chinese with friends.">
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f8f6f2;color:#272421;font:17px/1.5 system-ui,sans-serif}main{max-width:420px;text-align:center;padding:32px 24px}h1{font-size:32px;line-height:1.15}nav{display:grid;gap:10px;margin:24px 0}a{border:1px solid #9b4145;color:#9b4145;padding:12px 20px;border-radius:14px;text-decoration:none;font-weight:600}a.primary{background:#9b4145;color:white}a:focus-visible{outline:3px solid #272421;outline-offset:4px}</style>
</head><body><main><h1>Connect on Daily Hanzi</h1>
<p>Open Daily Hanzi to find your friend and send a request.</p>
<nav aria-label="Open or install Daily Hanzi">
<a class="primary" href="${openApp}">Open Daily Hanzi</a>
<a href="${appleStoreUrl}">Download on the App Store</a>
<a href="${googlePlayUrl}">Get it on Google Play</a>
</nav><p>Just installed? Come back to this link after signing in.</p></main></body></html>`, { headers });
}

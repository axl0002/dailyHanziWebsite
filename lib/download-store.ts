export const appleStoreUrl = 'https://apps.apple.com/app/daily-hanzi/id6756919959';
export const googlePlayUrl = 'https://play.google.com/store/apps/details?id=com.alexliu.dailyhanzi';

export function downloadStore(userAgent: string): string | null {
  if (/android/i.test(userAgent)) return googlePlayUrl;
  if (/iPhone|iPad|iPod/i.test(userAgent) ||
      (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent))) return appleStoreUrl;
  return null;
}

export const downloadFallbackHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Get Daily Hanzi</title><meta name="description" content="Learn Chinese with friends on Daily Hanzi.">
<meta property="og:title" content="Learn Chinese with friends — Daily Hanzi">
<meta property="og:description" content="Get Daily Hanzi for iPhone or Android.">
<meta name="robots" content="noindex,nofollow">
<style>body{margin:0;background:#f8f6f2;color:#272421;font:18px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100svh}main{max-width:420px;text-align:center;padding:32px 24px}h1{font-size:34px;line-height:1.2}p{color:#706b65}nav{display:grid;gap:12px;margin-top:28px}a{background:#c25456;color:white;padding:14px 24px;border-radius:16px;text-decoration:none;font-weight:600}a:focus-visible{outline:3px solid #272421;outline-offset:4px}</style>
</head><body><main><h1>Get Daily Hanzi</h1><p>Learn Chinese with friends.</p><nav aria-label="Download Daily Hanzi"><a href="${appleStoreUrl}">Download on the App Store</a><a href="${googlePlayUrl}">Get it on Google Play</a></nav></main>
<script>if(/Macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1){location.replace(${JSON.stringify(appleStoreUrl)});}</script>
</body></html>`;

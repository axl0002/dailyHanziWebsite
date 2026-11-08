import { downloadFallbackHtml, downloadStore } from '../../lib/download-store';

export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const destination = downloadStore(request.headers.get('user-agent') ?? '');
  // Device redirects must never be cached and served to a different platform.
  const headers = { 'Cache-Control': 'no-store', Vary: 'User-Agent',
    'X-Robots-Tag': 'noindex, nofollow' };
  return destination
    ? new Response(null, { status: 302, headers: { ...headers, Location: destination } })
    : new Response(downloadFallbackHtml, { status: 200,
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
}

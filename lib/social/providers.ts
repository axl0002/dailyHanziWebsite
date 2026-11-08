import { counter, safePostUrl, type Platform, type Snapshot } from './metrics'

export type SocialAccount = { platform: Platform; accountId: string; label: string; accessToken: string; refreshToken?: string }
export function accounts(): SocialAccount[] {
    const parsed: unknown = JSON.parse(process.env.SOCIAL_ACCOUNTS_JSON || '[]')
    if (!Array.isArray(parsed) || parsed.some(a => !a || (a.refreshToken !== undefined && (typeof a.refreshToken !== 'string' || !a.refreshToken)) || !['instagram', 'tiktok'].includes(a.platform) ||
        ![a.accountId, a.label, a.accessToken].every(v => typeof v === 'string' && v.length > 0) || /[\r\n]/.test(a.accessToken))) {
        throw new Error('Invalid SOCIAL_ACCOUNTS_JSON configuration.')
    }
    const keys = parsed.map(a => `${a.platform}:${a.accountId}`)
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate social account configuration.')
    return parsed
}
async function request(url: URL, token: string, body?: object) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
        .catch(() => { throw new Error('Provider connection failed or timed out. Retry collection.') })
    // Do not return provider response bodies: they may contain credentials or private data.
    if (!response.ok) throw new Error(`Provider request failed (${response.status}); check token, scopes and API access.`)
    const data = await response.json()
    if (data.error && data.error.code !== 'ok') throw new Error('Provider rejected the request; check token, scopes and API access.')
    return data
}
export async function collect(account: SocialAccount, now = new Date()): Promise<Snapshot[]> {
    const base = { platform: account.platform, account_id: account.accountId, label: account.label,
        day: now.toISOString().slice(0, 10), observed_at: now.toISOString() }
    const rows: Snapshot[] = []
    if (account.platform === 'instagram') {
        const version = process.env.INSTAGRAM_GRAPH_VERSION || 'v27.0'
        if (!/^v\d+\.0$/.test(version)) throw new Error('Invalid Instagram Graph version.')
        let after: string | undefined
        for (let page = 0; ; page++) {
            if (page >= 500) throw new Error('Instagram pagination limit reached; no partial snapshot saved.')
            const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(account.accountId)}/media`)
            url.searchParams.set('fields', 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count')
            url.searchParams.set('limit', '100')
            if (after) url.searchParams.set('after', after)
            const result = await request(url, account.accessToken)
            if (!Array.isArray(result.data)) throw new Error('Unexpected Instagram media response.')
            for (const media of result.data) {
                const insightsUrl = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(media.id)}/insights`)
                // Meta documents media views as organic only; total_views includes ads.
                insightsUrl.searchParams.set('metric', 'views')
                // Fail this account on insight errors, rather than silently storing zero.
                const insights = await request(insightsUrl, account.accessToken)
                const views = insights.data?.find((m: { name: string }) => m.name === 'views')?.values?.[0]?.value
                rows.push({ ...base, post_id: media.id, caption: media.caption || '',
                    format: media.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : media.media_product_type === 'REELS' ? 'Reel' : media.media_type === 'IMAGE' ? 'Photo' : 'Video',
                    permalink: safePostUrl(media.permalink, 'instagram'), published_at: media.timestamp,
                    views: counter(views), likes: counter(media.like_count), comments: counter(media.comments_count), shares: null })
            }
            if (!result.paging?.next) break
            const next = result.paging?.cursors?.after
            if (!next || next === after) throw new Error('Invalid Instagram pagination cursor.')
            after = next
        }
    } else {
        let cursor: number | undefined
        for (let page = 0; ; page++) {
            if (page >= 500) throw new Error('TikTok pagination limit reached; no partial snapshot saved.')
            const url = new URL('https://open.tiktokapis.com/v2/video/list/')
            url.searchParams.set('fields', 'id,create_time,title,video_description,share_url,view_count,like_count,comment_count,share_count')
            const result = await request(url, account.accessToken, { max_count: 20, ...(cursor === undefined ? {} : { cursor }) })
            if (!Array.isArray(result.data?.videos)) throw new Error('Unexpected TikTok video response.')
            for (const video of result.data.videos) rows.push({ ...base, post_id: video.id,
                caption: video.video_description || video.title || '', format: 'Video',
                permalink: safePostUrl(video.share_url, 'tiktok'), published_at: new Date(video.create_time * 1000).toISOString(),
                views: counter(video.view_count), likes: counter(video.like_count), comments: counter(video.comment_count), shares: counter(video.share_count) })
            if (!result.data.has_more) break
            if (typeof result.data.cursor !== 'number' || result.data.cursor === cursor) throw new Error('Invalid TikTok pagination cursor.')
            cursor = result.data.cursor
        }
    }
    return rows
}

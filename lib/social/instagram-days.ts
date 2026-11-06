import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialAccount } from './providers'
import { counter } from './metrics'
import { appId } from './server'

export type InstagramDay = {
    day: string; account_id: string; total_views: number | null; ad_views: number | null; organic_views: number | null;
    status: 'complete' | 'unavailable' | 'unverified'; collected_at: string;
}
const surfaces = new Set(['AD', 'POST', 'FEED', 'CAROUSEL_CONTAINER', 'REEL', 'REELS', 'STORY'])
// Only derive organic views from a complete, reconciled breakdown of the SAME
// views metric. Never subtract Ads Manager impressions or assume unknown data is zero.
export function parseInstagramViews(payload: unknown) {
    const empty = { total_views: null, ad_views: null, organic_views: null, status: 'unavailable' as InstagramDay['status'], breakdown: {} as Record<string, number> }
    if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray(payload.data)) return empty
    const metric = payload.data.find(m => m?.name === 'views')
    const total = counter(metric?.total_value?.value)
    if (total === null) return empty
    const unverified = { ...empty, total_views: total, status: 'unverified' as const }
    const groups = metric.total_value.breakdowns
    if (!Array.isArray(groups) || groups.length !== 1) return unverified
    const group = groups[0]
    if (!group || typeof group !== 'object') return unverified
    if (!Array.isArray(group.dimension_keys) || group.dimension_keys.length !== 1 || group.dimension_keys[0] !== 'media_product_type' || !Array.isArray(group.results)) return unverified
    const breakdown: Record<string, number> = {}
    let sum = 0
    for (const entry of group.results) {
        const dimensions = entry?.dimension_values
        const value = counter(entry?.value)
        if (!Array.isArray(dimensions) || dimensions.length !== 1 || typeof dimensions[0] !== 'string' ||
            !surfaces.has(dimensions[0]) || Object.hasOwn(breakdown, dimensions[0]) || value === null) return unverified
        breakdown[dimensions[0]] = value
        sum += value
        if (!Number.isSafeInteger(sum)) return unverified
    }
    if (sum !== total) return unverified
    const ads = breakdown.AD ?? 0
    return { total_views: total, ad_views: ads, organic_views: total - ads, status: 'complete' as const, breakdown }
}

export async function syncInstagramDays(account: SocialAccount, db: SupabaseClient, now = new Date(), historyDays = 90) {
    if (account.platform !== 'instagram') return 0
    if (!Number.isInteger(historyDays) || historyDays < 2 || historyDays > 90) throw new Error('Invalid Instagram history window.')
    const version = process.env.INSTAGRAM_GRAPH_VERSION || 'v27.0'
    if (!/^v\d+\.0$/.test(version)) throw new Error('Invalid Instagram Graph version.')
    const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
    const start = new Date(today - (historyDays - 1) * 86400000).toISOString().slice(0, 10)
    const end = new Date(today - 86400000).toISOString().slice(0, 10)
    const { data, error } = await db.from('instagram_account_days').select('day').eq('app_id', appId()).eq('account_id', account.accountId).gte('day', start).lte('day', end)
    if (error) throw new Error('Apply the Instagram daily-insights migration in the marketing project.')
    const existing = new Set((data ?? []).map(row => row.day))
    const plan: { day: string; since: number; until: number }[] = []
    for (let offset = historyDays - 1; offset >= 1; offset--) {
        const since = (today - offset * 86400000) / 1000
        const day = new Date(since * 1000).toISOString().slice(0, 10)
        // Exclude today's incomplete UTC day. Revisit the latest three completed
        // dates because Meta can revise metrics after a delay of up to 48 hours.
        if (!existing.has(day) || offset <= 3) plan.push({ day, since, until: since + 86400 - 1 })
    }
    const rows = []
    for (let offset = 0; offset < plan.length; offset += 4) {
        const batch = await Promise.all(plan.slice(offset, offset + 4).map(async date => {
            const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(account.accountId)}/insights`)
            url.search = new URLSearchParams({ metric: 'views', metric_type: 'total_value', period: 'day',
                breakdown: 'media_product_type', since: String(date.since), until: String(date.until) }).toString()
            let response: Response
            try { response = await fetch(url, { headers: { Authorization: `Bearer ${account.accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(20000) }) }
            catch { throw new Error('Instagram daily insights timed out; previous history was preserved.') }
            const body = await response.json().catch(() => ({}))
            if (!response.ok || body.error) {
                const code = typeof body.error?.code === 'number' ? `; code ${body.error.code}` : ''
                throw new Error(`Instagram daily insights failed (HTTP ${response.status}${code}); previous history was preserved.`)
            }
            return { app_id: appId(), account_id: account.accountId, label: account.label, day: date.day,
                ...parseInstagramViews(body), collected_at: now.toISOString() }
        }))
        rows.push(...batch)
    }
    if (rows.length) {
        const { error: saveError } = await db.rpc('save_instagram_account_days', { rows })
        if (saveError) throw new Error('Could not save Instagram daily insights; previous history was preserved.')
    }
    return rows.length
}

export function aggregateInstagramDays(rows: InstagramDay[], accountIds: string[], days: string[]) {
    const expected = [...new Set(accountIds)]
    const byDay = new Map<string, Map<string, InstagramDay>>()
    for (const row of rows) {
        if (!expected.includes(row.account_id)) continue
        const accounts = byDay.get(row.day) ?? new Map<string, InstagramDay>()
        accounts.set(row.account_id, row); byDay.set(row.day, accounts)
    }
    return days.map(day => {
        const accounts = byDay.get(day)
        const complete = expected.length > 0 && expected.every(id => {
            const row = accounts?.get(id)
            return row?.status === 'complete' && counter(row.organic_views) !== null && counter(row.ad_views) !== null &&
                counter(row.total_views) !== null && row.organic_views! + row.ad_views! === row.total_views
        })
        const totals = { day, organic: null as number | null, ads: null as number | null, total: null as number | null }
        if (!complete) return totals
        const values = expected.map(id => accounts!.get(id)!)
        const organic = values.reduce((sum, row) => sum + row.organic_views!, 0)
        const ads = values.reduce((sum, row) => sum + row.ad_views!, 0)
        const total = values.reduce((sum, row) => sum + row.total_views!, 0)
        return [organic, ads, total].every(Number.isSafeInteger) ? { day, organic, ads, total } : totals
    })
}

import { appDatabase, appId, database } from './server'

export type SignupDay = { app_id: string; day: string; signups: number; instagram_referrals: number;
    tiktok_referrals: number; other_referrals: number; unknown_referrals: number; collected_at: string }
export function referralCategory(value: unknown): 'instagram_referrals' | 'tiktok_referrals' | 'other_referrals' | 'unknown_referrals' {
    if (typeof value !== 'string' || !value.trim()) return 'unknown_referrals'
    if (/instagram/i.test(value)) return 'instagram_referrals'
    if (/tik\s*tok/i.test(value)) return 'tiktok_referrals'
    return 'other_referrals'
}
export async function syncSignups(marketing: ReturnType<typeof database>, now = new Date()) {
    const id = appId()
    const app = appDatabase()
    const end = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
    const start = new Date(end.getTime() - 89 * 86400000)
    const until = new Date(end.getTime() + 86400000)
    const days = new Map<string, SignupDay>()
    for (let i = 0; i < 90; i++) {
        const day = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10)
        days.set(day, { app_id: id, day, signups: 0, instagram_referrals: 0, tiktok_referrals: 0,
            other_referrals: 0, unknown_referrals: 0, collected_at: now.toISOString() })
    }
    // Only timestamps and survey answers enter memory; no individual rows or free text are written to marketing.
    for (let page = 0; ; page++) {
        const { data, error } = await app.from('profiles').select('created_at,referral_source:survey_responses->>referral_source').eq('is_beta', false)
            .gte('created_at', start.toISOString()).lt('created_at', until.toISOString())
            .order('created_at').order('id').range(page * 1000, page * 1000 + 999)
        if (error) throw new Error('Could not read app signup data; existing marketing aggregates were preserved.')
        for (const profile of data || []) {
            const day = days.get(profile.created_at.slice(0, 10))
            if (!day) continue
            day.signups++
            day[referralCategory(profile.referral_source)]++
        }
        if ((data?.length || 0) < 1000) break
    }
    const rows = [...days.values()]
    const { error } = await marketing.rpc('save_marketing_signup_days', { rows })
    if (error) throw new Error('Could not save signup aggregates. Apply the migration in the marketing project.')
    return rows.length
}

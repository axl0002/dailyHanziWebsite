import { connectedAccounts } from '@/lib/social/instagram-auth'
import { NextResponse } from 'next/server'
import { accounts } from '@/lib/social/providers'
import { summarize, type Snapshot } from '@/lib/social/metrics'
import { appId, database, failure, SocialError, staff } from '@/lib/social/server'
import { sync } from '@/lib/social/sync'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
    try {
        await staff()
        const days = Number(new URL(request.url).searchParams.get('days') || 30)
        if (![7, 30, 90].includes(days)) throw new SocialError('Choose 7, 30 or 90 days.')
        const end = new Date().toISOString().slice(0, 10)
        const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10)
        const baseline = new Date(Date.parse(`${start}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
        const db = database()
        const snapshots: Snapshot[] = []
        for (let page = 0; ; page++) {
            const { data, error } = await db.from('social_snapshots').select('*').eq('app_id', appId()).gte('day', baseline).lte('day', end)
                .order('day').order('platform').order('account_id').order('post_id').range(page * 1000, page * 1000 + 999)
            if (error) throw new SocialError('Apply the migration in supabase/marketing/migrations to the marketing project.', 503)
            snapshots.push(...(data || []))
            if ((data?.length || 0) < 1000) break
        }
        const summary = summarize(snapshots, start, end)
        const daily = new Map(Array.from({ length: days }, (_, i) => {
            const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)
            const social = summary.daily.find(d => d.day === day)
            return [day, { day, instagram: social?.instagram ?? null, tiktok: social?.tiktok ?? null, signups: null as number | null, instagramReferrals: null as number | null, tiktokReferrals: null as number | null, unknownReferrals: null as number | null }]
        }))
        const sources: Record<string, number> = {}
        const { data: signupDays, error: signupError } = await db.from('marketing_signup_days')
            .select('day,signups,instagram_referrals,tiktok_referrals,other_referrals,unknown_referrals,collected_at')
            .eq('app_id', appId()).gte('day', start).lte('day', end).order('day')
        if (signupError) throw new SocialError('Could not load marketing signup aggregates. Check the marketing migration.', 503)
        for (const row of signupDays || []) {
            const day = daily.get(row.day)
            if (!day) continue
            day.signups = row.signups
            day.instagramReferrals = row.instagram_referrals
            day.tiktokReferrals = row.tiktok_referrals
            day.unknownReferrals = row.unknown_referrals
            for (const [name, count] of Object.entries({ Instagram: row.instagram_referrals, TikTok: row.tiktok_referrals,
                Other: row.other_referrals, Unknown: row.unknown_referrals })) sources[name] = (sources[name] || 0) + Number(count)
        }
        const { data: runs, error } = await db.from('social_sync_runs').select('id,platform,account_id,label,started_at,completed_at,status,post_count,message')
            .eq('app_id', appId()).order('started_at', { ascending: false }).limit(100)
        if (error) throw new SocialError('Could not load sync history.', 500)
        return NextResponse.json({ daily: [...daily.values()], posts: summary.posts, sources, runs, signupCoverage: { measuredDays: signupDays?.length || 0, totalDays: days,
                lastCollectedAt: signupDays?.length ? signupDays.map(row => row.collected_at).sort()[0] : null },
            accounts: (await connectedAccounts(db, accounts())).map(({ platform, accountId, label }) => ({ platform, accountId, label })) }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
    try {
        if (request.headers.get('origin') !== new URL(request.url).origin) throw new SocialError('Invalid request origin.', 403)
        await staff()
        const results = await sync()
        return NextResponse.json({ results }, { status: results.some(r => r.status === 'error') ? 502 : 200, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) { return failure(error) }
}

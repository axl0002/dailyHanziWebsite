import { syncInstagramDays } from './instagram-days'
import { connectedAccounts } from './instagram-auth'
import { tiktokToken } from './tiktok-token'
import { accounts, collect } from './providers'
import { syncSignups } from './signups'
import { appId, database, SocialError } from './server'
export async function sync() {
    const db = database()
    const configured = await connectedAccounts(db, accounts())
    const app_id = appId()
    const results: { platform: string; label: string; status: string; posts?: number; message?: string }[] = []
    try {
        const days = await syncSignups(db)
        results.push({ platform: 'app', label: 'Signup aggregates', status: 'success', message: `${days} days refreshed` })
    } catch {
        results.push({ platform: 'app', label: 'Signup aggregates', status: 'error', message: 'Could not sync signup aggregates. Check app read access and the marketing migration; previous aggregates are preserved.' })
    }
    // Each account commits independently, so one expired token does not hide other results.
    for (const account of configured) {
        const { error: staleError } = await db.from('social_sync_runs').update({ status: 'error', completed_at: new Date().toISOString(),
            message: 'Previous sync timed out; retry collection.' }).eq('platform', account.platform).eq('account_id', account.accountId)
            .eq('status', 'running').lt('started_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
        if (staleError) throw new SocialError('Apply the migration in supabase/marketing/migrations to the marketing project before syncing.', 503)
        const { data: run, error } = await db.from('social_sync_runs').insert({ platform: account.platform,
            app_id, account_id: account.accountId, label: account.label, status: 'running' }).select('id').single()
        if (error?.code === '23505') {
            results.push({ platform: account.platform, label: account.label, status: 'error', message: 'This account is already syncing. Try again later.' })
            continue
        }
        if (error || !run) throw new SocialError('Apply the migration in supabase/marketing/migrations to the marketing project before syncing.', 503)
        try {
            const accessToken = await tiktokToken(account, db)
            let dailyError: string | null = null
            if (account.platform === 'instagram') {
                try {
                    const days = await syncInstagramDays({ ...account, accessToken }, db)
                    results.push({ platform: 'instagram', label: `${account.label} daily organic views`, status: 'success', message: `${days} dates refreshed` })
                } catch (error) {
                    dailyError = error instanceof Error ? error.message : 'Could not refresh daily organic views.'
                    results.push({ platform: 'instagram', label: `${account.label} daily organic views`, status: 'error', message: dailyError })
                }
            }
            const rows = (await collect({ ...account, accessToken })).map(row => ({ ...row, app_id }))
            const { error: saveError } = await db.rpc('save_social_snapshots', { rows })
            if (saveError) throw new Error('Could not save account snapshots. Check database migration.')
            const { error: finishError } = await db.from('social_sync_runs').update({ status: dailyError ? 'error' : 'success', message: dailyError,
                completed_at: new Date().toISOString(), post_count: rows.length }).eq('id', run.id)
            if (finishError) throw new Error('Snapshots saved, but could not record sync completion.')
            results.push({ platform: account.platform, label: account.label, status: 'success', posts: rows.length })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Account sync failed.'
            await db.from('social_sync_runs').update({ status: 'error', completed_at: new Date().toISOString(), message }).eq('id', run.id)
            results.push({ platform: account.platform, label: account.label, status: 'error', message })
        }
    }
    return results
}

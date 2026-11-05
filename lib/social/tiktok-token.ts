import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialAccount } from './providers'

// Caller holds the account's running-sync lease before refreshing a rotating token.
export async function tiktokToken(account: SocialAccount, db: SupabaseClient): Promise<string> {
    if (account.platform !== 'tiktok' || !account.refreshToken) return account.accessToken
    const clientKey = process.env.TIKTOK_CLIENT_KEY
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET
    if (!clientKey || !clientSecret) throw new Error('Configure TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET for token refresh.')
    const { data, error } = await db.from('social_tiktok_tokens').select('refresh_token').eq('account_id', account.accountId).maybeSingle()
    if (error) throw new Error('Could not read TikTok refresh credentials; check database migration.')
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret,
            grant_type: 'refresh_token', refresh_token: data?.refresh_token || account.refreshToken }),
    })
    if (!response.ok) throw new Error(`TikTok token refresh failed (${response.status}). Reauthorize the account if needed.`)
    const token = await response.json()
    if (token.error || typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || token.open_id !== account.accountId) {
        throw new Error('TikTok token refresh failed or account ID does not match the authorized open_id.')
    }
    const { error: saveError } = await db.from('social_tiktok_tokens').upsert({ account_id: account.accountId,
        refresh_token: token.refresh_token, updated_at: new Date().toISOString() })
    if (saveError) throw new Error('Could not persist rotated TikTok refresh token. Reauthorization may be required.')
    return token.access_token
}

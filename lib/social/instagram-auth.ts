import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialAccount } from './providers'
import { appId, SocialError } from './server'

export const instagramStateCookie = '__Host-instagram-oauth-state'
export function instagramConfig() {
    const clientId = process.env.INSTAGRAM_META_APP_ID?.trim()
    const clientSecret = process.env.INSTAGRAM_META_APP_SECRET?.trim()
    const configId = process.env.INSTAGRAM_LOGIN_CONFIG_ID?.trim()
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI?.trim()
    const version = process.env.INSTAGRAM_GRAPH_VERSION || 'v27.0'
    if (!clientId || !clientSecret || !configId || !redirectUri) {
        throw new SocialError('Configure INSTAGRAM_META_APP_ID, INSTAGRAM_META_APP_SECRET, INSTAGRAM_LOGIN_CONFIG_ID and INSTAGRAM_REDIRECT_URI in Vercel, then redeploy.', 503)
    }
    let uri: URL
    try { uri = new URL(redirectUri) } catch { throw new SocialError('Invalid Instagram redirect URI.', 503) }
    if (uri.protocol !== 'https:' || uri.pathname !== '/api/admin/instagram/callback' || uri.search || uri.hash || uri.username || uri.password || !/^\d+$/.test(clientId) || !/^\d+$/.test(configId) || !/^v\d+\.0$/.test(version)) {
        throw new SocialError('Configure an HTTPS Instagram callback at /api/admin/instagram/callback and valid Meta app/configuration IDs.', 503)
    }
    encryptionKey()
    return { clientId, clientSecret, configId, redirectUri, version }
}
function encryptionKey() {
    const value = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || ''
    const key = Buffer.from(value, 'base64')
    if (key.length !== 32 || key.toString('base64') !== value) throw new SocialError('Configure SOCIAL_TOKEN_ENCRYPTION_KEY as a random 32-byte base64 key on the server.', 503)
    return key
}
function aad(accountId: string) { return Buffer.from(`${appId()}:instagram:${accountId}`) }
export function encryptToken(token: string, accountId: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
    cipher.setAAD(aad(accountId))
    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.')
}
export function decryptToken(value: string, accountId: string) {
    try {
        const parts = value.split('.')
        if (parts.length !== 3) throw new Error('Invalid ciphertext')
        const [iv, tag, encrypted] = parts.map(part => Buffer.from(part, 'base64'))
        const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
        cipher.setAAD(aad(accountId)); cipher.setAuthTag(tag)
        return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8')
    } catch { throw new SocialError('An Instagram connection cannot be decrypted. Restore the encryption key or reconnect the account.', 503) }
}
export function loginUrl(state: string) {
    const config = instagramConfig()
    const url = new URL('https://www.facebook.com/dialog/oauth')
    url.search = new URLSearchParams({ client_id: config.clientId, config_id: config.configId,
        redirect_uri: config.redirectUri, response_type: 'code', prompt: 'login', state }).toString()
    return url
}
async function meta(url: URL, token?: string) {
    let response: Response
    try { response = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) }) }
    catch { throw new SocialError('Instagram connection timed out. Please reconnect.', 502) }
    // Meta errors may contain tokens, codes or identifiers. Never forward their bodies.
    if (!response.ok) throw new SocialError('Meta rejected the connection. Check app credentials, redirect URI, permissions and selected account access.', 502)
    const body = await response.json()
    if (body.error) throw new SocialError('Meta rejected the connection. Check configuration and permissions.', 502)
    return body
}
export async function authorizeInstagram(code: string, db: SupabaseClient) {
    const config = instagramConfig()
    const exchange = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`)
    // This is Meta's documented server-to-server code exchange. This URL is never logged or sent to the browser.
    exchange.search = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        code, redirect_uri: config.redirectUri }).toString()
    const grant = await meta(exchange)
    if (typeof grant.access_token !== 'string' || !grant.access_token) throw new SocialError('Meta did not return an access token.', 502)
    const token = grant.access_token as string
    const granted: { id: string; username: string }[] = []
    const seen = new Set<string>()
    let after: string | undefined
    for (let page = 0; ; page++) {
        if (page >= 100) throw new SocialError('Too many authorized accounts. Connection was not saved.', 502)
        const url = new URL(`https://graph.facebook.com/${config.version}/me/assigned_instagram_accounts`)
        url.searchParams.set('fields', 'id,username')
        url.searchParams.set('limit', '100')
        if (after) url.searchParams.set('after', after)
        const result = await meta(url, token)
        if (!Array.isArray(result.data)) throw new SocialError('Meta did not return the authorized Instagram accounts.', 502)
        for (const account of result.data) {
            if (typeof account.id !== 'string' || !/^\d+$/.test(account.id) || typeof account.username !== 'string') throw new SocialError('Unexpected Instagram account details.', 502)
            if (!seen.has(account.id)) { seen.add(account.id); granted.push(account) }
        }
        if (!result.paging?.next) break
        const next = result.paging?.cursors?.after
        if (typeof next !== 'string' || !next || next === after) throw new SocialError('Invalid Instagram account pagination.', 502)
        after = next
    }
    if (!granted.length) throw new SocialError('No Instagram account was shared. Reconnect and select your professional account.', 400)
    // Verify insight permission before persisting a connection. No need for a Page or ads permissions.
    for (const account of granted) {
        const url = new URL(`https://graph.facebook.com/${config.version}/${account.id}/insights`)
        url.search = new URLSearchParams({ metric: 'views', period: 'day', metric_type: 'total_value' }).toString()
        await meta(url, token)
    }
    const expires = typeof grant.expires_in === 'number' && grant.expires_in > 0 ? new Date(Date.now() + grant.expires_in * 1000).toISOString() : null
    const { error } = await db.from('social_instagram_connections').upsert(granted.map(account => ({
        app_id: appId(), account_id: account.id, username: account.username,
        encrypted_access_token: encryptToken(token, account.id), token_expires_at: expires, updated_at: new Date().toISOString(),
    })), { onConflict: 'app_id,account_id' })
    if (error) throw new SocialError('Could not save Instagram connection. Check the marketing connection migration.', 503)
    return granted.length
}
export async function connectedAccounts(db: SupabaseClient, configured: SocialAccount[]): Promise<SocialAccount[]> {
    const { data, error } = await db.from('social_instagram_connections').select('account_id,username,encrypted_access_token,token_expires_at').eq('app_id', appId())
    if (error) throw new SocialError('Apply the Instagram connection migration in supabase/marketing/migrations.', 503)
    const connected = (data ?? []).map(row => {
        if (row.token_expires_at && Date.parse(row.token_expires_at) <= Date.now()) throw new SocialError(`Instagram connection for @${row.username} expired. Reconnect it.`, 503)
        return { platform: 'instagram' as const, accountId: row.account_id, label: `@${row.username}`, accessToken: decryptToken(row.encrypted_access_token, row.account_id) }
    })
    const ids = new Set(connected.map(account => account.accountId))
    return [...configured.filter(account => account.platform !== 'instagram' || !ids.has(account.accountId)), ...connected]
}

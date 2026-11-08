import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialAccount } from './providers'
import { appId, SocialError } from './server'

export const instagramStateCookie = '__Host-instagram-oauth-state'
function instagramAppConfig() {
    const clientId = process.env.INSTAGRAM_META_APP_ID?.trim()
    const clientSecret = process.env.INSTAGRAM_META_APP_SECRET?.trim()
    const version = process.env.INSTAGRAM_GRAPH_VERSION || 'v27.0'
    if (!clientId || !clientSecret || !/^\d+$/.test(clientId) || !/^v\d+\.0$/.test(version)) {
        throw new SocialError('Configure INSTAGRAM_META_APP_ID and INSTAGRAM_META_APP_SECRET with a valid Graph version in Vercel.', 503)
    }
    encryptionKey()
    return { clientId, clientSecret, version }
}
export function instagramConfig() {
    const app = instagramAppConfig()
    const configId = process.env.INSTAGRAM_LOGIN_CONFIG_ID?.trim()
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI?.trim()
    if (!configId || !redirectUri) throw new SocialError('Configure INSTAGRAM_LOGIN_CONFIG_ID and INSTAGRAM_REDIRECT_URI in Vercel, then redeploy.', 503)
    let uri: URL
    try { uri = new URL(redirectUri) } catch { throw new SocialError('Invalid Instagram redirect URI.', 503) }
    if (uri.protocol !== 'https:' || uri.pathname !== '/api/admin/instagram/callback' || uri.search || uri.hash || uri.username || uri.password || !/^\d+$/.test(configId)) {
        throw new SocialError('Configure an HTTPS Instagram callback at /api/admin/instagram/callback and a valid configuration ID.', 503)
    }
    return { ...app, configId, redirectUri }
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
        redirect_uri: config.redirectUri, response_type: 'code', override_default_response_type: 'true', prompt: 'login', state }).toString()
    return url
}
async function meta(url: URL, token?: string, stage = 'request') {
    let response: Response
    try { response = await fetch(url, { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) }) }
    catch { throw new SocialError('Instagram connection timed out. Please reconnect.', 502) }
    // Meta errors may contain tokens, codes or identifiers. Never forward their bodies.
    const body = await response.json().catch(() => ({}))
    if (!response.ok || body.error) {
        const code = typeof body.error?.code === 'number' ? `; code ${body.error.code}` : ''
        const subcode = typeof body.error?.error_subcode === 'number' ? `; subcode ${body.error.error_subcode}` : ''
        throw new SocialError(`Instagram ${stage} failed (HTTP ${response.status}${code}${subcode}). Check app credentials, redirect URI and granted permissions.`, 502)
    }
    return body
}
export async function authorizeInstagram(code: string, db: SupabaseClient, progress?: (stage: string) => Promise<void>) {
    const config = instagramConfig()
    const exchange = new URL(`https://graph.facebook.com/${config.version}/oauth/access_token`)
    // This is Meta's documented server-to-server code exchange. This URL is never logged or sent to the browser.
    exchange.search = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
        code, redirect_uri: config.redirectUri }).toString()
    await progress?.('code_exchange')
    const grant = await meta(exchange, undefined, 'code exchange')
    if (typeof grant.access_token !== 'string' || !grant.access_token) throw new SocialError('Meta did not return an access token.', 502)
    const token = grant.access_token as string
    await progress?.('account_discovery')
    const granted: { id: string; username: string }[] = []
    const seen = new Set<string>()
    let after: string | undefined
    for (let page = 0; ; page++) {
        if (page >= 100) throw new SocialError('Too many authorized accounts. Connection was not saved.', 502)
        const url = new URL(`https://graph.facebook.com/${config.version}/me/assigned_instagram_accounts`)
        url.searchParams.set('fields', 'id,username')
        url.searchParams.set('limit', '100')
        if (after) url.searchParams.set('after', after)
        const result = await meta(url, token, 'account discovery')
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
    if (!granted.length) throw new SocialError('Meta returned no delegated Instagram accounts. If this business owns both the app and Instagram account, use the business-owned system user connection on this page.', 400)
    // Verify insight permission before persisting a connection. No need for a Page or ads permissions.
    await progress?.('insights_check')
    for (const account of granted) {
        const url = new URL(`https://graph.facebook.com/${config.version}/${account.id}/insights`)
        url.search = new URLSearchParams({ metric: 'views', period: 'day', metric_type: 'total_value' }).toString()
        await meta(url, token, 'insights permission check')
    }
    const expires = typeof grant.expires_in === 'number' && grant.expires_in > 0 ? new Date(Date.now() + grant.expires_in * 1000).toISOString() : null
    await progress?.('saving_connection')
    const { error } = await db.from('social_instagram_connections').upsert(granted.map(account => ({
        app_id: appId(), account_id: account.id, username: account.username,
        encrypted_access_token: encryptToken(token, account.id), token_expires_at: expires, updated_at: new Date().toISOString(),
    })), { onConflict: 'app_id,account_id' })
    if (error) throw new SocialError('Could not save Instagram connection. Check the marketing connection migration.', 503)
    return granted.length
}
// First-party connection: the business owns both the app and the Instagram account.
// Validate the token and direct account access instead of asking a hidden B2B
// integration system user to enumerate delegated client assets.
export async function connectPortfolioInstagram(accountId: string, token: string, db: SupabaseClient,
    progress?: (stage: string) => Promise<void>) {
    if (!/^\d+$/.test(accountId) || !token || /\s/.test(token)) throw new SocialError('Enter the numeric Instagram account ID and a system user token.')
    const config = instagramAppConfig()
    await progress?.('token_validation')
    const debugUrl = new URL(`https://graph.facebook.com/${config.version}/debug_token`)
    debugUrl.searchParams.set('input_token', token)
    // Meta's documented introspection endpoint is called only from this server;
    // neither the request URL nor its response is logged or returned to clients.
    const debug = await meta(debugUrl, `${config.clientId}|${config.clientSecret}`, 'system user token validation')
    const info = debug.data
    if (!info || info.is_valid !== true || info.app_id !== config.clientId || info.type !== 'SYSTEM_USER') {
        throw new SocialError('Use a valid System User token generated for the Daily Hanzi Meta app.')
    }
    if (!Array.isArray(info.scopes) || !['instagram_basic', 'instagram_manage_insights'].every(scope => info.scopes.includes(scope))) {
        throw new SocialError('The token must include instagram_basic and instagram_manage_insights. Generate it with those permissions.')
    }
    const expiry = typeof info.expires_at === 'number' && info.expires_at > 0 ? info.expires_at * 1000 : null
    if (expiry && expiry <= Date.now()) throw new SocialError('This system user token has expired. Generate a new token.')
    await progress?.('account_validation')
    const profileUrl = new URL(`https://graph.facebook.com/${config.version}/${accountId}`)
    profileUrl.searchParams.set('fields', 'id,username')
    const profile = await meta(profileUrl, token, 'direct Instagram account access')
    if (profile.id !== accountId || typeof profile.username !== 'string' || !profile.username) {
        throw new SocialError('Could not verify that Instagram account. Check its numeric ID and the system user asset assignments.')
    }
    await progress?.('insights_check')
    const insightsUrl = new URL(`https://graph.facebook.com/${config.version}/${accountId}/insights`)
    insightsUrl.search = new URLSearchParams({ metric: 'views', period: 'day', metric_type: 'total_value' }).toString()
    await meta(insightsUrl, token, 'insights permission check')
    await progress?.('saving_connection')
    const { error } = await db.from('social_instagram_connections').upsert({
        app_id: appId(), account_id: accountId, username: profile.username,
        encrypted_access_token: encryptToken(token, accountId), token_expires_at: expiry ? new Date(expiry).toISOString() : null,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'app_id,account_id' })
    if (error) throw new SocialError('Could not save the Instagram connection. Check marketing database access.', 503)
    return { accountId, username: profile.username as string }
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

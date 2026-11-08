import { updateAttempt } from '@/lib/social/instagram-attempts'
import { timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { database, SocialError, staff } from '@/lib/social/server'
import { authorizeInstagram, instagramConfig, instagramStateCookie } from '@/lib/social/instagram-auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
    const jar = await cookies()
    const expected = jar.get(instagramStateCookie)?.value
    jar.set(instagramStateCookie, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 })
    // Fixed local path: neither provider parameters nor caller headers control redirects.
    const destination = new URL('/admin/acquisition', new URL(request.url).origin)
    let verifiedState: string | null = null
    let stage = 'callback_validation'
    try {
        await staff()
        const config = instagramConfig()
        if (new URL(request.url).origin !== new URL(config.redirectUri).origin) throw new SocialError('Instagram callback origin does not match configuration.')
        const params = new URL(request.url).searchParams
        const state = params.get('state') || ''
        if (expected && /^[a-f0-9]{64}$/.test(expected)) verifiedState = expected
        if (!expected || !/^[a-f0-9]{64}$/.test(state) || expected.length !== state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) throw new SocialError('Instagram connection expired or could not be verified. Try again.')
        verifiedState = state
        await updateAttempt(database(), state, stage)
        if (params.has('error')) throw new SocialError('Instagram connection canceled or not authorized. Try again.')
        const code = params.get('code')
        if (!code || code.length > 4096) throw new SocialError('Meta did not return a valid authorization code.')
        const db = database()
        const count = await authorizeInstagram(code, db, async next => {
            stage = next
            await updateAttempt(db, state, stage)
        })
        await updateAttempt(db, state, 'complete', 'connected', `Connected ${count} Instagram account(s).`)
        destination.searchParams.set('instagram_connected', String(count))
    } catch (error) {
        const message = error instanceof SocialError ? error.message : 'Instagram connection failed. Please try again.'
        destination.searchParams.set('instagram_error', message)
        if (verifiedState) {
            try { await updateAttempt(database(), verifiedState, stage, 'error', message) }
            catch { console.error('Instagram connection progress could not be saved', { stage }) }
        }
        // No provider URLs, raw errors, OAuth codes, state, or tokens are logged.
        console.error('Instagram OAuth callback failed', { stage, status: error instanceof SocialError ? error.status : 500 })
    }
    return NextResponse.redirect(destination, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

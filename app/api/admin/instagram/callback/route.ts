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
    try {
        await staff()
        const config = instagramConfig()
        if (new URL(request.url).origin !== new URL(config.redirectUri).origin) throw new SocialError('Instagram callback origin does not match configuration.')
        const params = new URL(request.url).searchParams
        const state = params.get('state') || ''
        if (!expected || !/^[a-f0-9]{64}$/.test(state) || expected.length !== state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) throw new SocialError('Instagram connection expired or could not be verified. Try again.')
        if (params.has('error')) throw new SocialError('Instagram connection canceled or not authorized. Try again.')
        const code = params.get('code')
        if (!code || code.length > 4096) throw new SocialError('Meta did not return a valid authorization code.')
        const count = await authorizeInstagram(code, database())
        destination.searchParams.set('instagram_connected', String(count))
    } catch (error) {
        destination.searchParams.set('instagram_error', error instanceof SocialError ? error.message : 'Instagram connection failed. Please try again.')
    }
    return NextResponse.redirect(destination, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

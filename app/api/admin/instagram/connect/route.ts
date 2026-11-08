import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { database, failure, SocialError, staff } from '@/lib/social/server'
import { instagramConfig, instagramStateCookie, loginUrl } from '@/lib/social/instagram-auth'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
    try {
        await staff()
        const config = instagramConfig()
        if (request.headers.get('origin') !== new URL(config.redirectUri).origin) throw new SocialError('Start the connection from the configured admin website.', 403)
        database()
        const state = randomBytes(32).toString('hex')
        const jar = await cookies()
        jar.set(instagramStateCookie, state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
        return NextResponse.redirect(loginUrl(state), { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
    } catch (error) { return failure(error) }
}

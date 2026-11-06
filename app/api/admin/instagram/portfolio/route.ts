import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { beginAttempt, updateAttempt } from '@/lib/social/instagram-attempts'
import { connectPortfolioInstagram } from '@/lib/social/instagram-auth'
import { database, failure, SocialError, staff } from '@/lib/social/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
    let attempt: string | null = null
    let stage = 'request_validation'
    try {
        if (request.headers.get('origin') !== new URL(request.url).origin) throw new SocialError('Invalid request origin.', 403)
        await staff()
        const raw = await request.text()
        if (raw.length > 100000) throw new SocialError('Connection request is too large.', 413)
        let body
        try { body = JSON.parse(raw) } catch { throw new SocialError('Invalid connection request.') }
        if (typeof body?.accountId !== 'string' || typeof body?.accessToken !== 'string') throw new SocialError('Enter the Instagram account ID and system user token.')
        const accountId = body.accountId.trim(), accessToken = body.accessToken.trim()
        if (!/^\d+$/.test(accountId) || !accessToken || /\s/.test(accessToken)) throw new SocialError('Enter a numeric Instagram account ID and a valid system user token.')
        const db = database()
        const id = randomBytes(32).toString('hex')
        await beginAttempt(db, id)
        attempt = id
        const account = await connectPortfolioInstagram(accountId, accessToken, db, async next => {
            stage = next
            await updateAttempt(db, id, stage)
        })
        const message = `Connected @${account.username}. Click Sync now to collect your first snapshot.`
        try { await updateAttempt(db, id, 'complete', 'connected', message) }
        catch { console.error('Instagram connection saved but progress update failed') }
        return NextResponse.json({ account, message }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
        if (attempt) {
            const message = error instanceof SocialError ? error.message : 'Business-owned Instagram connection failed.'
            try { await updateAttempt(database(), attempt, stage, 'error', message) }
            catch { console.error('Instagram connection progress could not be saved', { stage }) }
        }
        return failure(error)
    }
}

import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { sync } from '@/lib/social/sync'
import { failure, SocialError } from '@/lib/social/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
    try {
        const secret = process.env.CRON_SECRET
        const actual = Buffer.from(request.headers.get('authorization') || '')
        const expected = Buffer.from(`Bearer ${secret}`)
        if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SocialError('Unauthorized.', 401)
        const results = await sync()
        return NextResponse.json({ results }, { status: results.some(r => r.status === 'error') ? 502 : 200, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) { return failure(error) }
}

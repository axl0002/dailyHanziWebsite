import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
export class SocialError extends Error {
    constructor(message: string, public status = 400) { super(message) }
}
export function appId() {
    const id = process.env.MARKETING_APP_ID
    if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
        throw new SocialError('Configure MARKETING_APP_ID (for example daily-hanzi).', 503)
    }
    return id
}
export function database() {
    const url = process.env.MARKETING_SUPABASE_URL
    const key = process.env.MARKETING_SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new SocialError('Configure MARKETING_SUPABASE_URL and MARKETING_SUPABASE_SERVICE_ROLE_KEY for the separate marketing project.', 503)
    try {
        const marketing = new URL(url)
        const app = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
        if (marketing.protocol !== 'https:' || marketing.hostname === app.hostname) throw new Error('Invalid marketing project')
    } catch {
        throw new SocialError('Marketing must use a separate Supabase project with an HTTPS URL.', 503)
    }
    appId()
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
// Read-only use: the app database remains the source of signup/referral aggregates.
export function appDatabase() {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!key) throw new SocialError('Configure the app SUPABASE_SERVICE_ROLE_KEY to sync signup aggregates.', 503)
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
export async function staff() {
    const jar = await cookies()
    const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookies: { getAll: () => jar.getAll(), setAll: () => {} },
    })
    const { data: { user } } = await auth.auth.getUser()
    if (!user) throw new SocialError('Please sign in.', 401)
    const { data, error } = await auth.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin')
    if (error || !data?.length) throw new SocialError('Admin access required.', 403)
}
export function failure(error: unknown) {
    return NextResponse.json({ error: error instanceof SocialError ? error.message : 'Acquisition request failed. Check server configuration and the marketing migration.' },
        { status: error instanceof SocialError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } })
}

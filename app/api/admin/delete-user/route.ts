import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const userId = (body as { userId?: unknown })?.userId
    if (typeof userId !== 'string' || !userId) {
        return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // Verify caller has admin or moderator role. Same pattern as middleware.
    const cookieStore = await cookies()
    const authClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll() {
                    /* Route handlers don't need to write cookies here. */
                },
            },
        },
    )
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: roleRows, error: roleErr } = await authClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'moderator'])
    if (roleErr) {
        return NextResponse.json({ error: `Role lookup failed: ${roleErr.message}` }, { status: 500 })
    }
    if (!roleRows || roleRows.length === 0) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Delete via service-role auth admin API. Cascades to profiles via FK.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
        return NextResponse.json(
            { error: 'Server missing SUPABASE_SERVICE_ROLE_KEY env var' },
            { status: 500 },
        )
    }
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { DailyPrompt } from '@/lib/dailyPrompts';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
    try {
        const jar = await cookies();
        const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
            cookies: { getAll: () => jar.getAll(), setAll: () => {} },
        });
        const { data: { user }, error: authError } = await auth.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401, headers });
        const { data: roles, error: roleError } = await auth.from('user_roles').select('role').eq('user_id', user.id).in('role', ['admin', 'moderator']);
        if (roleError || !roles?.length) return NextResponse.json({ error: 'Admin or moderator access required.' }, { status: 403, headers });
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!key) return NextResponse.json({ error: 'Daily prompts server configuration is incomplete.' }, { status: 503, headers });
        // Server-only access lets staff inspect inactive prompts too, without changing mobile RLS.
        const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
        const prompts: DailyPrompt[] = [];
        const pageSize = 1000;
        for (let offset = 0; ; offset += pageSize) {
            const { data, error } = await db.from('social_prompts')
                .select('id, slug, response_type, title, instructions_en, instructions_zh, starter_zh, starter_en, hints, active, created_at, last_used_on, question_audio_url, starter_audio_url')
                .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize - 1);
            if (error) throw new Error('Prompt query failed');
            prompts.push(...(data ?? []));
            if (!data || data.length < pageSize) break;
        }
        return NextResponse.json({ prompts }, { headers });
    } catch {
        return NextResponse.json({ error: 'Could not load daily prompts. Please try again.' }, { status: 500, headers });
    }
}

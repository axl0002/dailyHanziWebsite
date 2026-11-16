import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { responseTypes } from '@/lib/promptAnalytics';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
    try {
        const jar = await cookies();
        const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
            cookies: { getAll: () => jar.getAll(), setAll: () => {} },
        });
        const { data: { user }, error: authError } = await auth.auth.getUser();
        if (authError || !user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401, headers });
        const { data: roles, error: roleError } = await auth.from('user_roles').select('role').eq('user_id', user.id).in('role', ['admin', 'moderator']);
        if (roleError || !roles?.length) return NextResponse.json({ error: 'Staff access required.' }, { status: 403, headers });
        const params = new URL(request.url).searchParams;
        const days = Number(params.get('days') ?? 30);
        const type = params.get('type') || null;
        if (![14, 30, 90].includes(days) || (type && !responseTypes.some(value => value === type))) {
            return NextResponse.json({ error: 'Invalid date range or response type.' }, { status: 400, headers });
        }
        const end = new Date(); const start = new Date(end);
        start.setUTCDate(start.getUTCDate() - days + 1);
        const startDate = start.toISOString().slice(0, 10), endDate = end.toISOString().slice(0, 10);
        const { data, error } = await auth.rpc('admin_daily_prompt_analytics', { p_start: startDate, p_end: endDate, p_type: type });
        if (error) throw new Error('Analytics query failed');
        return NextResponse.json({ rows: data ?? [], startDate, endDate }, { headers });
    } catch { return NextResponse.json({ error: 'Could not load prompt analytics. Please retry.' }, { status: 500, headers }); }
}

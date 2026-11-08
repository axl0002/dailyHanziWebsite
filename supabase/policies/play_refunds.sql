-- Run in each app's Supabase SQL editor before enabling Google Play refunds.
create table if not exists public.play_refunds (
    id uuid primary key default gen_random_uuid(),
    package_name text not null,
    order_id text not null,
    actor_id uuid not null,
    user_id uuid,
    status text not null check (status in ('processing', 'submitted', 'needs_review')),
    order_total jsonb not null,
    refund_total jsonb,
    warnings jsonb,
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    unique (package_name, order_id)
);
alter table public.play_refunds enable row level security;
revoke all on public.play_refunds from public, anon, authenticated, service_role;
grant select on public.play_refunds to service_role;
grant update (status, refund_total, warnings, completed_at) on public.play_refunds to service_role;
-- Only the authenticated staff server endpoint can read/write using service_role.
-- Never delete a processing/needs_review record without checking Play Console.

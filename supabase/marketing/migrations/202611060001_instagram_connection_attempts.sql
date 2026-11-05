-- Dedicated marketing project only. No access tokens, auth codes, or raw state.
create table if not exists public.social_instagram_connection_attempts (
    id text primary key check (id ~ '^[0-9a-f]{64}$'),
    app_id text not null,
    status text not null check (status in ('started','processing','connected','error')),
    stage text not null,
    message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists social_instagram_attempts_app_created on public.social_instagram_connection_attempts(app_id, created_at desc);
alter table public.social_instagram_connection_attempts enable row level security;
revoke all on public.social_instagram_connection_attempts from public, anon, authenticated;
grant all on public.social_instagram_connection_attempts to service_role;

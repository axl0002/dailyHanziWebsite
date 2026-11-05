-- Dedicated marketing project only. OAuth tokens are encrypted by the server.
create table if not exists public.social_instagram_connections (
    app_id text not null,
    account_id text not null,
    username text not null,
    encrypted_access_token text not null,
    token_expires_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (app_id, account_id)
);
alter table public.social_instagram_connections enable row level security;
revoke all on public.social_instagram_connections from public, anon, authenticated;
grant all on public.social_instagram_connections to service_role;

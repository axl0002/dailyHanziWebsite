-- Apply ONLY in the dedicated marketing Supabase project, never an app project. Rotating TikTok refresh tokens are service-role only.
create table if not exists public.social_snapshots (
    app_id text not null,
    platform text not null check (platform in ('instagram', 'tiktok')),
    account_id text not null, post_id text not null, day date not null,
    observed_at timestamptz not null, label text not null, caption text not null,
    format text not null, permalink text, published_at timestamptz not null,
    views bigint check (views >= 0), likes bigint check (likes >= 0),
    comments bigint check (comments >= 0), shares bigint check (shares >= 0),
    primary key (app_id, platform, account_id, post_id, day)
);
create index if not exists social_snapshots_day on public.social_snapshots(app_id, day);
create table if not exists public.social_sync_runs (
    id uuid primary key default gen_random_uuid(), app_id text not null, platform text not null,
    account_id text not null, label text not null, started_at timestamptz not null default now(),
    completed_at timestamptz, status text not null check (status in ('running', 'success', 'error')),
    post_count integer, message text
);
alter table public.social_snapshots enable row level security;
alter table public.social_sync_runs enable row level security;
revoke all on public.social_snapshots, public.social_sync_runs from anon, authenticated;
grant all on public.social_snapshots, public.social_sync_runs to service_role;

-- Transactional account writes prevent failed pagination from creating partial baselines.
create or replace function public.save_social_snapshots(rows jsonb) returns void
language sql set search_path = public as $$
    insert into public.social_snapshots
    select * from jsonb_populate_recordset(null::public.social_snapshots, rows)
    on conflict (app_id, platform, account_id, post_id, day) do update set
        observed_at = excluded.observed_at, label = excluded.label, caption = excluded.caption,
        format = excluded.format, permalink = excluded.permalink, published_at = excluded.published_at,
        views = excluded.views, likes = excluded.likes, comments = excluded.comments, shares = excluded.shares
    where excluded.observed_at > social_snapshots.observed_at;
$$;
revoke all on function public.save_social_snapshots(jsonb) from public, anon, authenticated;
grant execute on function public.save_social_snapshots(jsonb) to service_role;

-- A running account lease serializes token rotation and manual/cron syncs.
create unique index if not exists social_sync_one_running_account
    on public.social_sync_runs(platform, account_id) where status = 'running';
create table if not exists public.social_tiktok_tokens (
    account_id text primary key, refresh_token text not null, updated_at timestamptz not null default now()
);
alter table public.social_tiktok_tokens enable row level security;
revoke all on public.social_tiktok_tokens from anon, authenticated;
grant all on public.social_tiktok_tokens to service_role;

-- Contains counts only: no user IDs, emails, or free-text survey responses.
create table if not exists public.marketing_signup_days (
    app_id text not null, day date not null, signups integer not null check (signups >= 0),
    instagram_referrals integer not null check (instagram_referrals >= 0),
    tiktok_referrals integer not null check (tiktok_referrals >= 0),
    other_referrals integer not null check (other_referrals >= 0),
    unknown_referrals integer not null check (unknown_referrals >= 0),
    collected_at timestamptz not null,
    primary key (app_id, day),
    check (signups = instagram_referrals + tiktok_referrals + other_referrals + unknown_referrals)
);
alter table public.marketing_signup_days enable row level security;
revoke all on public.marketing_signup_days from anon, authenticated;
grant all on public.marketing_signup_days to service_role;

create or replace function public.save_marketing_signup_days(rows jsonb) returns void
language sql set search_path = public as $$
    insert into public.marketing_signup_days
    select * from jsonb_populate_recordset(null::public.marketing_signup_days, rows)
    on conflict (app_id, day) do update set
        signups = excluded.signups, instagram_referrals = excluded.instagram_referrals,
        tiktok_referrals = excluded.tiktok_referrals, other_referrals = excluded.other_referrals,
        unknown_referrals = excluded.unknown_referrals, collected_at = excluded.collected_at
    where excluded.collected_at > marketing_signup_days.collected_at;
$$;
revoke all on function public.save_marketing_signup_days(jsonb) from public, anon, authenticated;
grant execute on function public.save_marketing_signup_days(jsonb) to service_role;

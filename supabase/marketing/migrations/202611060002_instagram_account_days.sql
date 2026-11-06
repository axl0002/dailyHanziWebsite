-- Dedicated marketing project only. Historical account views, reconciled to
-- Meta's media_product_type breakdown; AD is excluded from organic_views.
create table if not exists public.instagram_account_days (
    app_id text not null,
    account_id text not null,
    label text not null,
    day date not null,
    total_views bigint check (total_views >= 0),
    ad_views bigint check (ad_views >= 0),
    organic_views bigint check (organic_views >= 0),
    status text not null check (status in ('complete','unavailable','unverified')),
    breakdown jsonb not null default '{}'::jsonb,
    collected_at timestamptz not null,
    primary key (app_id, account_id, day),
    check ((status = 'complete' and total_views is not null and ad_views is not null and organic_views is not null and total_views = ad_views + organic_views)
        or (status <> 'complete' and ad_views is null and organic_views is null))
);
alter table public.instagram_account_days enable row level security;
revoke all on public.instagram_account_days from public, anon, authenticated;
grant all on public.instagram_account_days to service_role;
create or replace function public.save_instagram_account_days(rows jsonb) returns void
language sql set search_path = public as $$
    insert into public.instagram_account_days
    select * from jsonb_populate_recordset(null::public.instagram_account_days, rows)
    on conflict (app_id, account_id, day) do update set
        label = excluded.label, total_views = excluded.total_views, ad_views = excluded.ad_views,
        organic_views = excluded.organic_views, status = excluded.status, breakdown = excluded.breakdown,
        collected_at = excluded.collected_at
    where excluded.collected_at > instagram_account_days.collected_at;
$$;
revoke all on function public.save_instagram_account_days(jsonb) from public, anon, authenticated;
grant execute on function public.save_instagram_account_days(jsonb) to service_role;

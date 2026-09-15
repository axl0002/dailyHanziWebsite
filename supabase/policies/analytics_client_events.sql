-- Aggregations over public.client_events for the /admin/analytics tab.
-- client_events has an insert-only RLS policy for users writing their own
-- events; there's no direct staff SELECT policy, so all reads go through
-- these SECURITY DEFINER + is_staff() RPCs.
--
-- Each RPC returns a jsonb array of rows with pro/free/total counts, matching
-- the shape used by sentences_read_histogram et al. Client charts pick which
-- cohort to render.
--
-- All three include the "no usage" cohort so we can compare "how much are
-- users using this feature" — non-installers, non-tappers show up as the
-- 'None' / '0' bucket, denominator = all non-beta profiles.

-- Supporting index. Without this the pool count SELECT does a Seq Scan over
-- all 197k profile rows (~2s cold) which trips the 8s authenticated
-- statement_timeout when the whole analytics grid loads at once. Index-only
-- scan drops it to ~50ms warm / ~600ms cold.
create index if not exists profiles_is_beta_is_pro_idx
    on public.profiles (is_beta, is_pro);

drop function if exists public.widget_install_stats(timestamptz);
drop function if exists public.widget_install_breakdown(timestamptz);
drop function if exists public.widget_tap_stats(timestamptz);
drop function if exists public.notification_tap_stats(timestamptz);

-- Widget adoption. For each non-beta profile we look at the latest
-- widget_installed/widget_removed event per (user, surface) pair to figure
-- out what's currently installed, then bucket the user into exactly one of
-- {None, Home only, Lock only, Both}. since_date is intentionally ignored:
-- adoption is a current-state metric, not a windowed one.
create or replace function public.widget_install_stats(
    since_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    result jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    -- since_date is deliberately unused here; keep the arg so the client
    -- signature matches the sibling RPCs.
    perform since_date;
    -- Two disjoint aggregations then subtract, so we never group-by 200k profile
    -- rows. Only touches profiles (a) once for the pool total, (b) once per
    -- widget-event user for is_pro lookup (indexed pkey).
    with events as (
        select
            ce.user_id,
            coalesce(ce.props->>'surface', 'unknown') as surface,
            ce.event,
            ce.created_at
        from public.client_events ce
        where ce.event in ('widget_installed', 'widget_removed')
    ),
    latest as (
        select distinct on (user_id, surface)
            user_id, surface, event
        from events
        order by user_id, surface, created_at desc
    ),
    per_user as (
        select
            user_id,
            bool_or(surface = 'home' and event = 'widget_installed') as has_home,
            bool_or(surface = 'lock' and event = 'widget_installed') as has_lock
        from latest
        group by user_id
    ),
    installed as (
        select
            p.is_pro,
            case
                when u.has_home and u.has_lock then 'Both'
                when u.has_home then 'Home only'
                when u.has_lock then 'Lock only'
                else null
            end as bucket
        from per_user u
        join public.profiles p on p.id = u.user_id
        where p.is_beta = false
    ),
    installed_counts as (
        select
            bucket,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from installed
        where bucket is not null
        group by bucket
    ),
    pool as (
        select
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from public.profiles
        where is_beta = false
    ),
    none_row as (
        select
            'None'::text as bucket,
            pool.pro - coalesce((select sum(pro) from installed_counts), 0)::bigint as pro,
            pool.free - coalesce((select sum(free) from installed_counts), 0)::bigint as free,
            pool.total - coalesce((select sum(total) from installed_counts), 0)::bigint as total
        from pool
    ),
    all_buckets(bucket, sort_order) as (
        values ('None', 0), ('Lock only', 1), ('Home only', 2), ('Both', 3)
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb) into result
    from (
        select
            ab.bucket,
            ab.sort_order,
            coalesce(x.pro, 0)::bigint as pro,
            coalesce(x.free, 0)::bigint as free,
            coalesce(x.total, 0)::bigint as total
        from all_buckets ab
        left join (
            select bucket, pro, free, total from installed_counts
            union all
            select bucket, pro, free, total from none_row
        ) x on x.bucket = ab.bucket
    ) t;
    return result;
end;
$$;

revoke all on function public.widget_install_stats(timestamptz) from public;
grant execute on function public.widget_install_stats(timestamptz) to authenticated;


-- Widget install breakdown by (widget type, surface). Same currently-installed
-- semantics as widget_install_stats — latest install/remove for the tuple
-- must be an install. The widget name is normalized (lowercase, strip a
-- trailing "Widget" suffix) so early-version "CharacterWidget" collapses
-- with later "character" and we get one row per real widget kind.
-- since_date is ignored — this is current state, not a windowed metric.
create or replace function public.widget_install_breakdown(
    since_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    result jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    perform since_date;
    with events as (
        select
            ce.user_id,
            lower(regexp_replace(coalesce(ce.props->>'widget', 'unknown'), 'Widget$', '', 'i')) as widget,
            coalesce(ce.props->>'surface', 'unknown') as surface,
            ce.event,
            ce.created_at
        from public.client_events ce
        where ce.event in ('widget_installed', 'widget_removed')
    ),
    latest as (
        select distinct on (user_id, widget, surface)
            user_id, widget, surface, event
        from events
        order by user_id, widget, surface, created_at desc
    ),
    installed as (
        select l.widget, l.surface, p.is_pro
        from latest l
        join public.profiles p on p.id = l.user_id
        where l.event = 'widget_installed'
          and p.is_beta = false
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.widget, t.surface), '[]'::jsonb) into result
    from (
        select
            widget,
            surface,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from installed
        group by widget, surface
    ) t;
    return result;
end;
$$;

revoke all on function public.widget_install_breakdown(timestamptz) from public;
grant execute on function public.widget_install_breakdown(timestamptz) to authenticated;


-- Histogram of non-beta profiles bucketed by how many widget_tapped events
-- they fired in the window. Users with 0 taps are included so we can see
-- what fraction of the pool never taps the widget.
create or replace function public.widget_tap_stats(
    since_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    result jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    with taps as (
        select user_id, count(*) as n
        from public.client_events
        where event = 'widget_tapped'
          and (since_date is null or created_at >= since_date)
        group by user_id
    ),
    user_totals as (
        select coalesce(t.n, 0) as tap_count, p.is_pro
        from public.profiles p
        left join taps t on t.user_id = p.id
        where p.is_beta = false
    ),
    bucketed as (
        select
            case
                when tap_count = 0 then '0'
                when tap_count between 1 and 2 then '1-2'
                when tap_count between 3 and 10 then '3-10'
                when tap_count between 11 and 50 then '11-50'
                else '50+'
            end as bucket,
            case
                when tap_count = 0 then 0
                when tap_count between 1 and 2 then 1
                when tap_count between 3 and 10 then 2
                when tap_count between 11 and 50 then 3
                else 4
            end as sort_order,
            is_pro
        from user_totals
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb) into result
    from (
        select
            bucket,
            sort_order,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from bucketed
        group by bucket, sort_order
    ) t;
    return result;
end;
$$;

revoke all on function public.widget_tap_stats(timestamptz) from public;
grant execute on function public.widget_tap_stats(timestamptz) to authenticated;


-- Distinct non-beta users who tapped ≥1 notification of each type in the
-- window, plus a synthetic 'None' row for users who tapped no notifications
-- at all. Bars overlap for the real type rows (a user can tap multiple
-- types); 'None' is disjoint from all of them.
create or replace function public.notification_tap_stats(
    since_date timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
    result jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    with taps as (
        select
            ce.user_id,
            coalesce(ce.props->>'type', 'unknown') as type
        from public.client_events ce
        where ce.event = 'notification_tapped'
          and (since_date is null or ce.created_at >= since_date)
    ),
    users_per_type as (
        select distinct user_id, type from taps
    ),
    by_type as (
        select
            u.type,
            count(*) filter (where p.is_pro = true)::bigint as pro,
            count(*) filter (where p.is_pro is null or p.is_pro = false)::bigint as free,
            count(*)::bigint as total,
            1 as sort_bucket
        from users_per_type u
        left join public.profiles p on p.id = u.user_id
        group by u.type
    ),
    none_row as (
        select
            'None (never tapped)' as type,
            count(*) filter (where p.is_pro = true)::bigint as pro,
            count(*) filter (where p.is_pro is null or p.is_pro = false)::bigint as free,
            count(*)::bigint as total,
            0 as sort_bucket
        from public.profiles p
        where p.is_beta = false
          and not exists (select 1 from taps t where t.user_id = p.id)
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_bucket, t.total desc), '[]'::jsonb) into result
    from (
        select type, pro, free, total, sort_bucket from none_row
        union all
        select type, pro, free, total, sort_bucket from by_type
    ) t;
    return result;
end;
$$;

revoke all on function public.notification_tap_stats(timestamptz) from public;
grant execute on function public.notification_tap_stats(timestamptz) to authenticated;

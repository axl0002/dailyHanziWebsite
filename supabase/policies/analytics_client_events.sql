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

drop function if exists public.widget_install_stats(timestamptz);
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
            p.id as user_id,
            p.is_pro,
            bool_or(l.surface = 'home' and l.event = 'widget_installed') as has_home,
            bool_or(l.surface = 'lock' and l.event = 'widget_installed') as has_lock
        from public.profiles p
        left join latest l on l.user_id = p.id
        where p.is_beta = false
        group by p.id, p.is_pro
    ),
    bucketed as (
        select
            is_pro,
            case
                when has_home and has_lock then 'Both'
                when has_home then 'Home only'
                when has_lock then 'Lock only'
                else 'None'
            end as bucket
        from per_user
    ),
    all_buckets(bucket, sort_order) as (
        values ('None', 0), ('Lock only', 1), ('Home only', 2), ('Both', 3)
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb) into result
    from (
        select
            ab.bucket,
            ab.sort_order,
            coalesce(count(b.is_pro) filter (where b.is_pro = true), 0)::bigint as pro,
            coalesce(count(b.is_pro) filter (where b.is_pro is null or b.is_pro = false), 0)::bigint as free,
            coalesce(count(*) filter (where b.bucket is not null), 0)::bigint as total
        from all_buckets ab
        left join bucketed b on b.bucket = ab.bucket
        group by ab.bucket, ab.sort_order
    ) t;
    return result;
end;
$$;

revoke all on function public.widget_install_stats(timestamptz) from public;
grant execute on function public.widget_install_stats(timestamptz) to authenticated;


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

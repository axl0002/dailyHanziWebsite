-- Histograms of users bucketed by how many characters they have in each
-- learning-state cohort. Powers the Post-paywall section of /admin/analytics:
--   * saved_characters_histogram      — user_saved_characters
--   * learned_characters_histogram    — user_seen_characters, strength = 3
--   * in_review_characters_histogram  — user_seen_characters, strength IN (1, 2)
--
-- All three follow the exact shape of sentences_read_histogram:
--   returns jsonb array of {bucket, sort_order, pro, free, total}
-- and are SECURITY DEFINER + is_staff() gated. jsonb_agg keeps them under
-- PostgREST's 1000-row cap.
--
-- The '0' bucket is (pool - active) via a single indexed pool count, not a
-- full LEFT JOIN of profiles into the read set — see the widget_install_stats
-- comment in analytics_client_events.sql for why (200k-row scan on profiles
-- with no supporting index used to trip the 8s authenticated timeout when
-- the whole grid loaded).
--
-- Bucket boundaries chosen to cover the observed spread (some Pro users
-- have thousands of characters at strength=3).
--
-- since_date filters the user cohort by profiles.created_at, not the event
-- timestamp. "Last 7d" = users who joined in the last 7 days, counted across
-- their full character-learning history. Matches profile_distributions so
-- every analytics chart reacts to the toolbar the same way.

drop function if exists public.saved_characters_histogram(timestamptz);
drop function if exists public.learned_characters_histogram(timestamptz);
drop function if exists public.in_review_characters_histogram(timestamptz);

create or replace function public.saved_characters_histogram(
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
    with counts_per_user as (
        select user_id, count(*) as n
        from public.user_saved_characters
        group by user_id
    ),
    active as (
        select
            p.is_pro,
            case
                when c.n between 1 and 10 then '1-10'
                when c.n between 11 and 50 then '11-50'
                when c.n between 51 and 200 then '51-200'
                when c.n between 201 and 500 then '201-500'
                when c.n between 501 and 1000 then '501-1000'
                else '1000+'
            end as bucket,
            case
                when c.n between 1 and 10 then 1
                when c.n between 11 and 50 then 2
                when c.n between 51 and 200 then 3
                when c.n between 201 and 500 then 4
                when c.n between 501 and 1000 then 5
                else 6
            end as sort_order
        from counts_per_user c
        join public.profiles p on p.id = c.user_id
        where p.is_beta = false
          and (since_date is null or p.created_at >= since_date)
    ),
    active_counts as (
        select
            bucket,
            sort_order,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from active
        group by bucket, sort_order
    ),
    pool as (
        select
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from public.profiles
        where is_beta = false
          and (since_date is null or created_at >= since_date)
    ),
    zero_row as (
        select
            '0'::text as bucket,
            0 as sort_order,
            (pool.pro - coalesce((select sum(pro) from active_counts), 0))::bigint as pro,
            (pool.free - coalesce((select sum(free) from active_counts), 0))::bigint as free,
            (pool.total - coalesce((select sum(total) from active_counts), 0))::bigint as total
        from pool
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb) into result
    from (
        select bucket, sort_order, pro, free, total from zero_row
        union all
        select bucket, sort_order, pro, free, total from active_counts
    ) t;
    return result;
end;
$$;
revoke all on function public.saved_characters_histogram(timestamptz) from public;
grant execute on function public.saved_characters_histogram(timestamptz) to authenticated;


create or replace function public.learned_characters_histogram(
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
    with counts_per_user as (
        select user_id, count(*) as n
        from public.user_seen_characters
        where strength = 3
        group by user_id
    ),
    active as (
        select
            p.is_pro,
            case
                when c.n between 1 and 5 then '1-5'
                when c.n between 6 and 10 then '6-10'
                when c.n between 11 and 50 then '11-50'
                when c.n between 51 and 200 then '51-200'
                when c.n between 201 and 500 then '201-500'
                when c.n between 501 and 1000 then '501-1000'
                else '1000+'
            end as bucket,
            case
                when c.n between 1 and 5 then 1
                when c.n between 6 and 10 then 2
                when c.n between 11 and 50 then 3
                when c.n between 51 and 200 then 4
                when c.n between 201 and 500 then 5
                when c.n between 501 and 1000 then 6
                else 7
            end as sort_order
        from counts_per_user c
        join public.profiles p on p.id = c.user_id
        where p.is_beta = false
          and (since_date is null or p.created_at >= since_date)
    ),
    active_counts as (
        select
            bucket,
            sort_order,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from active
        group by bucket, sort_order
    ),
    pool as (
        select
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from public.profiles
        where is_beta = false
          and (since_date is null or created_at >= since_date)
    ),
    zero_row as (
        select
            '0'::text as bucket,
            0 as sort_order,
            (pool.pro - coalesce((select sum(pro) from active_counts), 0))::bigint as pro,
            (pool.free - coalesce((select sum(free) from active_counts), 0))::bigint as free,
            (pool.total - coalesce((select sum(total) from active_counts), 0))::bigint as total
        from pool
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb) into result
    from (
        select bucket, sort_order, pro, free, total from zero_row
        union all
        select bucket, sort_order, pro, free, total from active_counts
    ) t;
    return result;
end;
$$;
revoke all on function public.learned_characters_histogram(timestamptz) from public;
grant execute on function public.learned_characters_histogram(timestamptz) to authenticated;


create or replace function public.in_review_characters_histogram(
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
    with counts_per_user as (
        select user_id, count(*) as n
        from public.user_seen_characters
        where strength in (1, 2)
        group by user_id
    ),
    active as (
        select
            p.is_pro,
            case
                when c.n between 1 and 5 then '1-5'
                when c.n between 6 and 10 then '6-10'
                when c.n between 11 and 50 then '11-50'
                when c.n between 51 and 200 then '51-200'
                when c.n between 201 and 500 then '201-500'
                when c.n between 501 and 1000 then '501-1000'
                else '1000+'
            end as bucket,
            case
                when c.n between 1 and 5 then 1
                when c.n between 6 and 10 then 2
                when c.n between 11 and 50 then 3
                when c.n between 51 and 200 then 4
                when c.n between 201 and 500 then 5
                when c.n between 501 and 1000 then 6
                else 7
            end as sort_order
        from counts_per_user c
        join public.profiles p on p.id = c.user_id
        where p.is_beta = false
          and (since_date is null or p.created_at >= since_date)
    ),
    active_counts as (
        select
            bucket,
            sort_order,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from active
        group by bucket, sort_order
    ),
    pool as (
        select
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from public.profiles
        where is_beta = false
          and (since_date is null or created_at >= since_date)
    ),
    zero_row as (
        select
            '0'::text as bucket,
            0 as sort_order,
            (pool.pro - coalesce((select sum(pro) from active_counts), 0))::bigint as pro,
            (pool.free - coalesce((select sum(free) from active_counts), 0))::bigint as free,
            (pool.total - coalesce((select sum(total) from active_counts), 0))::bigint as total
        from pool
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb) into result
    from (
        select bucket, sort_order, pro, free, total from zero_row
        union all
        select bucket, sort_order, pro, free, total from active_counts
    ) t;
    return result;
end;
$$;
revoke all on function public.in_review_characters_histogram(timestamptz) from public;
grant execute on function public.in_review_characters_histogram(timestamptz) to authenticated;

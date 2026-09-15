-- Histograms of users bucketed by how many sentences / stories they've marked
-- as read. Used by the /admin/analytics SentencesReadChart and StoriesReadChart.
-- SECURITY DEFINER + is_staff() gate. Returns jsonb array to bypass PostgREST's
-- db-max-rows cap on this project.
--
-- Returns pro + free counts per bucket so the client can render a stacked
-- bar chart matching the rest of the analytics grid. Client-side toolbar
-- decides whether to show pro, free, or both — RPC always returns both.
--
-- since_date is inclusive; pass null for all-time.
-- Users with 0 reads are included in the '0' bucket so % inactive is visible.

drop function if exists public.sentences_read_by_day(timestamptz);
drop function if exists public.stories_read_by_day(timestamptz);
drop function if exists public.sentences_read_histogram(timestamptz);
drop function if exists public.stories_read_histogram(timestamptz);
drop function if exists public.sentences_read_histogram(timestamptz, text);
drop function if exists public.stories_read_histogram(timestamptz, text);

create or replace function public.sentences_read_histogram(
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
    -- Aggregate the read events first, then join to profiles only for users
    -- who actually read (pkey lookup). The 0-bucket is (pool - active) via
    -- a single indexed pool count instead of a full-table LEFT JOIN of every
    -- profile row. Same pattern as widget_install_stats — see
    -- analytics_client_events.sql for the profiles_is_beta_is_pro_idx index.
    with reads_per_user as (
        select user_id, count(*) as n
        from public.daily_sentences
        where read_at is not null
          and (since_date is null or read_at >= since_date)
        group by user_id
    ),
    active as (
        select
            p.is_pro,
            case
                when r.n between 1 and 5 then '1-5'
                when r.n between 6 and 20 then '6-20'
                when r.n between 21 and 50 then '21-50'
                when r.n between 51 and 100 then '51-100'
                when r.n between 101 and 500 then '101-500'
                else '500+'
            end as bucket,
            case
                when r.n between 1 and 5 then 1
                when r.n between 6 and 20 then 2
                when r.n between 21 and 50 then 3
                when r.n between 51 and 100 then 4
                when r.n between 101 and 500 then 5
                else 6
            end as sort_order
        from reads_per_user r
        join public.profiles p on p.id = r.user_id
        where p.is_beta = false
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

revoke all on function public.sentences_read_histogram(timestamptz) from public;
grant execute on function public.sentences_read_histogram(timestamptz) to authenticated;


create or replace function public.stories_read_histogram(
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
    -- Same subtract-from-pool pattern as sentences_read_histogram. See that
    -- function's comment for the rationale.
    with reads_per_user as (
        select user_id, count(*) as n
        from public.user_paragraph_assignments
        where read_at is not null
          and (since_date is null or read_at >= since_date)
        group by user_id
    ),
    active as (
        select
            p.is_pro,
            case
                when r.n between 1 and 2 then '1-2'
                when r.n between 3 and 5 then '3-5'
                when r.n between 6 and 10 then '6-10'
                when r.n between 11 and 25 then '11-25'
                when r.n between 26 and 50 then '26-50'
                else '50+'
            end as bucket,
            case
                when r.n between 1 and 2 then 1
                when r.n between 3 and 5 then 2
                when r.n between 6 and 10 then 3
                when r.n between 11 and 25 then 4
                when r.n between 26 and 50 then 5
                else 6
            end as sort_order
        from reads_per_user r
        join public.profiles p on p.id = r.user_id
        where p.is_beta = false
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

revoke all on function public.stories_read_histogram(timestamptz) from public;
grant execute on function public.stories_read_histogram(timestamptz) to authenticated;

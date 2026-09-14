-- Histograms of users bucketed by how many characters they have in each
-- learning-state cohort. Powers the Post-paywall section of /admin/analytics:
--   * saved_characters_histogram      — user_saved_characters
--   * learned_characters_histogram    — user_seen_characters, strength = 3
--   * in_review_characters_histogram  — user_seen_characters, strength IN (1, 2)
--
-- All three follow the exact shape of sentences_read_histogram:
--   returns jsonb array of {bucket, sort_order, pro, free, total}
-- and are SECURITY DEFINER + is_staff() gated. jsonb_agg keeps them under
-- PostgREST's 1000-row cap. LEFT JOIN against profiles so users with 0 rows
-- in the source table show up in the '0' bucket.
--
-- Bucket boundaries chosen to cover the observed spread (some Pro users
-- have thousands of characters at strength=3).

drop function if exists public.saved_characters_histogram(timestamptz);
drop function if exists public.learned_characters_histogram(timestamptz);
drop function if exists public.in_review_characters_histogram(timestamptz);

-- Shared helper: given a per-user count CTE, return the jsonb histogram.
-- Rather than a Postgres function, we inline the case-when block in each
-- function since it's short and lets each function stay independent.

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
        where (since_date is null or saved_at >= since_date)
        group by user_id
    ),
    user_totals as (
        select coalesce(c.n, 0) as k, p.is_pro
        from public.profiles p
        left join counts_per_user c on c.user_id = p.id
        where p.is_beta = false
    ),
    bucketed as (
        select
            case
                when k = 0 then '0'
                when k between 1 and 10 then '1-10'
                when k between 11 and 50 then '11-50'
                when k between 51 and 200 then '51-200'
                when k between 201 and 500 then '201-500'
                when k between 501 and 1000 then '501-1000'
                else '1000+'
            end as bucket,
            case
                when k = 0 then 0
                when k between 1 and 10 then 1
                when k between 11 and 50 then 2
                when k between 51 and 200 then 3
                when k between 201 and 500 then 4
                when k between 501 and 1000 then 5
                else 6
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
          and (since_date is null or seen_at >= since_date)
        group by user_id
    ),
    user_totals as (
        select coalesce(c.n, 0) as k, p.is_pro
        from public.profiles p
        left join counts_per_user c on c.user_id = p.id
        where p.is_beta = false
    ),
    bucketed as (
        select
            case
                when k = 0 then '0'
                when k between 1 and 10 then '1-10'
                when k between 11 and 50 then '11-50'
                when k between 51 and 200 then '51-200'
                when k between 201 and 500 then '201-500'
                when k between 501 and 1000 then '501-1000'
                else '1000+'
            end as bucket,
            case
                when k = 0 then 0
                when k between 1 and 10 then 1
                when k between 11 and 50 then 2
                when k between 51 and 200 then 3
                when k between 201 and 500 then 4
                when k between 501 and 1000 then 5
                else 6
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
          and (since_date is null or seen_at >= since_date)
        group by user_id
    ),
    user_totals as (
        select coalesce(c.n, 0) as k, p.is_pro
        from public.profiles p
        left join counts_per_user c on c.user_id = p.id
        where p.is_beta = false
    ),
    bucketed as (
        select
            case
                when k = 0 then '0'
                when k between 1 and 10 then '1-10'
                when k between 11 and 50 then '11-50'
                when k between 51 and 200 then '51-200'
                when k between 201 and 500 then '201-500'
                when k between 501 and 1000 then '501-1000'
                else '1000+'
            end as bucket,
            case
                when k = 0 then 0
                when k between 1 and 10 then 1
                when k between 11 and 50 then 2
                when k between 51 and 200 then 3
                when k between 201 and 500 then 4
                when k between 501 and 1000 then 5
                else 6
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
revoke all on function public.in_review_characters_histogram(timestamptz) from public;
grant execute on function public.in_review_characters_histogram(timestamptz) to authenticated;

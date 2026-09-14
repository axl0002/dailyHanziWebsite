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
    with reads_per_user as (
        select user_id, count(*) as n
        from public.daily_sentences
        where read_at is not null
          and (since_date is null or read_at >= since_date)
        group by user_id
    ),
    user_totals as (
        select coalesce(r.n, 0) as read_count, p.is_pro
        from public.profiles p
        left join reads_per_user r on r.user_id = p.id
        where p.is_beta = false
    ),
    bucketed as (
        select
            case
                when read_count = 0 then '0'
                when read_count between 1 and 5 then '1-5'
                when read_count between 6 and 20 then '6-20'
                when read_count between 21 and 50 then '21-50'
                when read_count between 51 and 100 then '51-100'
                when read_count between 101 and 500 then '101-500'
                else '500+'
            end as bucket,
            case
                when read_count = 0 then 0
                when read_count between 1 and 5 then 1
                when read_count between 6 and 20 then 2
                when read_count between 21 and 50 then 3
                when read_count between 51 and 100 then 4
                when read_count between 101 and 500 then 5
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
    with reads_per_user as (
        select user_id, count(*) as n
        from public.user_paragraph_assignments
        where read_at is not null
          and (since_date is null or read_at >= since_date)
        group by user_id
    ),
    user_totals as (
        select coalesce(r.n, 0) as read_count, p.is_pro
        from public.profiles p
        left join reads_per_user r on r.user_id = p.id
        where p.is_beta = false
    ),
    bucketed as (
        select
            case
                when read_count = 0 then '0'
                when read_count between 1 and 2 then '1-2'
                when read_count between 3 and 5 then '3-5'
                when read_count between 6 and 10 then '6-10'
                when read_count between 11 and 25 then '11-25'
                when read_count between 26 and 50 then '26-50'
                else '50+'
            end as bucket,
            case
                when read_count = 0 then 0
                when read_count between 1 and 2 then 1
                when read_count between 3 and 5 then 2
                when read_count between 6 and 10 then 3
                when read_count between 11 and 25 then 4
                when read_count between 26 and 50 then 5
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

revoke all on function public.stories_read_histogram(timestamptz) from public;
grant execute on function public.stories_read_histogram(timestamptz) to authenticated;

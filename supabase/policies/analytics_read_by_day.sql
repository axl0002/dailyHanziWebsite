-- Daily counts of sentences / stories users have marked as read.
-- Used by the /admin/analytics page for the SentencesReadChart and
-- StoriesReadChart. SECURITY DEFINER + is_staff() gate.
--
-- `since_date` is inclusive; pass null to get the full history. Returns
-- one row per day with the read count (bigint), ordered oldest → newest.
--
-- Wrapped in jsonb_agg to bypass PostgREST's db-max-rows cap (1000 on this
-- project) — a year of history is 365 rows, which is well under, but keeping
-- the same shape as the other analytics RPCs for consistency and future-proofing.

drop function if exists public.sentences_read_by_day(timestamptz);
create or replace function public.sentences_read_by_day(since_date timestamptz default null)
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
    select coalesce(jsonb_agg(row_to_json(t) order by (t.day)), '[]'::jsonb) into result
    from (
        select
            (read_at at time zone 'UTC')::date as day,
            count(*)::bigint as n
        from public.daily_sentences
        where read_at is not null
          and (since_date is null or read_at >= since_date)
        group by 1
    ) t;
    return result;
end;
$$;

revoke all on function public.sentences_read_by_day(timestamptz) from public;
grant execute on function public.sentences_read_by_day(timestamptz) to authenticated;


drop function if exists public.stories_read_by_day(timestamptz);
create or replace function public.stories_read_by_day(since_date timestamptz default null)
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
    select coalesce(jsonb_agg(row_to_json(t) order by (t.day)), '[]'::jsonb) into result
    from (
        select
            (read_at at time zone 'UTC')::date as day,
            count(*)::bigint as n
        from public.user_paragraph_assignments
        where read_at is not null
          and (since_date is null or read_at >= since_date)
        group by 1
    ) t;
    return result;
end;
$$;

revoke all on function public.stories_read_by_day(timestamptz) from public;
grant execute on function public.stories_read_by_day(timestamptz) to authenticated;

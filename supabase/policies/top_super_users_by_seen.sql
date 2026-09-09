-- Sort super-users by number of distinct characters they've seen.
-- Runs a one-shot aggregation on user_seen_characters (~1.5M rows, ~3-6s on
-- Hanzi at the time of writing) and joins to profiles. The admin dashboard
-- caches the returned list client-side so the aggregation only runs once per
-- page load.
--
-- SECURITY DEFINER + is_staff() gate — regular authenticated users get an
-- exception if they call this. profiles RLS would already block them, but the
-- explicit gate makes the intent obvious.
--
-- Returns the same shape of columns the admin's toolbar filters + columns
-- panel needs (hsk_level, notifications_enabled, daily_goal, survey_responses
-- keys), so the client can filter the cached array without re-querying.
--
-- Returns a single jsonb array rather than SETOF ROW to bypass PostgREST's
-- `db-max-rows` cap (1000 on this project). PostgREST truncates SETOF results
-- at that limit; a jsonb payload passes through unlimited. The client parses
-- the array and treats it exactly like the old SETOF result.

drop function if exists public.top_super_users_by_seen(int);

create or replace function public.top_super_users_by_seen(max_rows int default 5000)
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
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into result
    from (
        select
            p.id,
            p.full_name,
            p.email,
            p.streak_days,
            p.longest_streak_days,
            p.is_pro,
            p.platform,
            p.timezone,
            p.created_at,
            p.hsk_level,
            p.notifications_enabled,
            p.daily_goal,
            p.survey_responses,
            coalesce(sc.n, 0)::bigint as seen_count
        from public.profiles p
        left join (
            select user_id, count(*) as n
            from public.user_seen_characters
            group by user_id
        ) sc on sc.user_id = p.id
        where p.is_beta = false
        order by coalesce(sc.n, 0) desc, p.id
        limit greatest(max_rows, 1)
    ) t;
    return result;
end;
$$;

revoke all on function public.top_super_users_by_seen(int) from public;
grant execute on function public.top_super_users_by_seen(int) to authenticated;

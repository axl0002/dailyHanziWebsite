-- Sort super-users by number of distinct characters they've seen.
-- Runs a one-shot aggregation on user_seen_characters (~1.5M rows, ~6s on Hanzi
-- at the time of writing) and joins to profiles. The admin dashboard caches the
-- returned list client-side so the aggregation only runs once per page load.
--
-- SECURITY DEFINER + is_staff() gate — regular authenticated users get an
-- exception if they call this. profiles RLS would already block them, but the
-- explicit gate makes the intent obvious.
--
-- Returns the same shape of columns the admin's toolbar filters + columns
-- panel needs (hsk_level, notifications_enabled, daily_goal, survey_responses
-- keys), so the client can filter the cached array without re-querying.

drop function if exists public.top_super_users_by_seen(int);

create or replace function public.top_super_users_by_seen(max_rows int default 5000)
returns table (
    id uuid,
    full_name text,
    email text,
    streak_days integer,
    longest_streak_days integer,
    is_pro boolean,
    platform text,
    timezone text,
    created_at timestamptz,
    hsk_level integer,
    notifications_enabled boolean,
    daily_goal integer,
    survey_responses jsonb,
    seen_count bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    return query
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
        limit greatest(max_rows, 1);
end;
$$;

revoke all on function public.top_super_users_by_seen(int) from public;
grant execute on function public.top_super_users_by_seen(int) to authenticated;

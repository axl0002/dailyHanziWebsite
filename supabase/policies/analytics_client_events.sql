-- Aggregations over public.client_events for the /admin/analytics tab.
-- client_events has an insert-only RLS policy for users writing their own
-- events; there's no direct staff SELECT policy, so all reads go through
-- these SECURITY DEFINER + is_staff() RPCs.
--
-- Each RPC returns a jsonb array of rows with pro/free/total counts, matching
-- the shape used by sentences_read_histogram et al. Client charts pick which
-- cohort to render.
--
-- since_date is inclusive; pass null for all-time.

drop function if exists public.widget_install_stats(timestamptz);
drop function if exists public.widget_tap_stats(timestamptz);
drop function if exists public.notification_tap_stats(timestamptz);

-- Distinct users per surface who currently have the widget installed. "Current"
-- = the most recent widget_installed/widget_removed event for that (user, surface)
-- pair is a widget_installed. Uninstalls thus decrement the count.
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
    with events as (
        select
            ce.user_id,
            coalesce(ce.props->>'surface', 'unknown') as surface,
            ce.event,
            ce.created_at
        from public.client_events ce
        where ce.event in ('widget_installed', 'widget_removed')
          and (since_date is null or ce.created_at >= since_date)
    ),
    latest as (
        select distinct on (user_id, surface)
            user_id, surface, event
        from events
        order by user_id, surface, created_at desc
    ),
    installed as (
        select l.user_id, l.surface, p.is_pro
        from latest l
        left join public.profiles p on p.id = l.user_id
        where l.event = 'widget_installed'
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.total desc), '[]'::jsonb) into result
    from (
        select
            surface,
            count(*) filter (where is_pro = true)::bigint as pro,
            count(*) filter (where is_pro is null or is_pro = false)::bigint as free,
            count(*)::bigint as total
        from installed
        group by surface
    ) t;
    return result;
end;
$$;

revoke all on function public.widget_install_stats(timestamptz) from public;
grant execute on function public.widget_install_stats(timestamptz) to authenticated;


-- Total widget_tapped events per surface. Multiple taps by the same user each
-- count separately — this measures engagement volume, not reach.
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
    select coalesce(jsonb_agg(row_to_json(t) order by t.total desc), '[]'::jsonb) into result
    from (
        select
            coalesce(ce.props->>'surface', 'unknown') as surface,
            count(*) filter (where p.is_pro = true)::bigint as pro,
            count(*) filter (where p.is_pro is null or p.is_pro = false)::bigint as free,
            count(*)::bigint as total
        from public.client_events ce
        left join public.profiles p on p.id = ce.user_id
        where ce.event = 'widget_tapped'
          and (since_date is null or ce.created_at >= since_date)
        group by coalesce(ce.props->>'surface', 'unknown')
    ) t;
    return result;
end;
$$;

revoke all on function public.widget_tap_stats(timestamptz) from public;
grant execute on function public.widget_tap_stats(timestamptz) to authenticated;


-- Total notification_tapped events grouped by props.type. Empty array is
-- returned until the client starts emitting these events.
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
    select coalesce(jsonb_agg(row_to_json(t) order by t.total desc), '[]'::jsonb) into result
    from (
        select
            coalesce(ce.props->>'type', 'unknown') as type,
            count(*) filter (where p.is_pro = true)::bigint as pro,
            count(*) filter (where p.is_pro is null or p.is_pro = false)::bigint as free,
            count(*)::bigint as total
        from public.client_events ce
        left join public.profiles p on p.id = ce.user_id
        where ce.event = 'notification_tapped'
          and (since_date is null or ce.created_at >= since_date)
        group by coalesce(ce.props->>'type', 'unknown')
    ) t;
    return result;
end;
$$;

revoke all on function public.notification_tap_stats(timestamptz) from public;
grant execute on function public.notification_tap_stats(timestamptz) to authenticated;

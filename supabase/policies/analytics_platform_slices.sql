-- Additive staff-only aggregates. Each request returns all platform slices.
-- Existing one-argument RPCs remain unchanged for older deployments.

CREATE OR REPLACE FUNCTION public.in_review_characters_histogram_platforms(since_date timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public as $function$
declare result jsonb;
begin
    if not public.is_staff() then raise exception 'not authorized'; end if;
    -- Scan activity once, then expand the cohort into combined and OS slices.
    with activity as materialized (
        select user_id, count(*) as n
        from public.user_seen_characters
        where strength in (1, 2)
        group by user_id
    ), base as materialized (
        select id,is_pro,platform from public.profiles
        where is_beta=false and (since_date is null or created_at>=since_date)
    ), per_user as (
        select p.is_pro,p.platform,
            case when coalesce(a.n,0)=0 then '0' else case
                when coalesce(a.n,0) between 1 and 5 then '1-5'
                when coalesce(a.n,0) between 6 and 10 then '6-10'
                when coalesce(a.n,0) between 11 and 50 then '11-50'
                when coalesce(a.n,0) between 51 and 200 then '51-200'
                when coalesce(a.n,0) between 201 and 500 then '201-500'
                when coalesce(a.n,0) between 501 and 1000 then '501-1000'
                else '1000+'
            end end as bucket,
            case when coalesce(a.n,0)=0 then 0 else case
                when coalesce(a.n,0) between 1 and 5 then 1
                when coalesce(a.n,0) between 6 and 10 then 2
                when coalesce(a.n,0) between 11 and 50 then 3
                when coalesce(a.n,0) between 51 and 200 then 4
                when coalesce(a.n,0) between 201 and 500 then 5
                when coalesce(a.n,0) between 501 and 1000 then 6
                else 7
            end end as sort_order
        from base p left join activity a on a.user_id=p.id
    ), counts as (
        select s.scope,p.bucket,p.sort_order,
            count(*) filter(where p.is_pro=true)::bigint as pro,
            count(*) filter(where p.is_pro is null or p.is_pro=false)::bigint as free,
            count(*)::bigint as total
        from per_user p cross join lateral (values ('all'::text),(p.platform)) s(scope)
        where s.scope in ('all','ios','android')
        group by s.scope,p.bucket,p.sort_order
    ), rows as (
        select scope,bucket,sort_order,pro,free,total from counts
        union all
        select s.scope,'0',0,0,0,0 from unnest(array['all','ios','android']) s(scope)
        where not exists(select 1 from counts c where c.scope=s.scope and c.bucket='0')
    ), slices as (
        select scope,jsonb_agg(jsonb_build_object('bucket',bucket,'sort_order',sort_order,'pro',pro,'free',free,'total',total) order by sort_order) as data
        from rows group by scope
    ) select jsonb_object_agg(scope,data) into result from slices;
    return result;
end;
$function$;


revoke all on function public.in_review_characters_histogram_platforms(timestamptz) from public,anon;
grant execute on function public.in_review_characters_histogram_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.learned_characters_histogram_platforms(since_date timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public as $function$
declare result jsonb;
begin
    if not public.is_staff() then raise exception 'not authorized'; end if;
    -- Scan activity once, then expand the cohort into combined and OS slices.
    with activity as materialized (
        select user_id, count(*) as n
        from public.user_seen_characters
        where strength = 3
        group by user_id
    ), base as materialized (
        select id,is_pro,platform from public.profiles
        where is_beta=false and (since_date is null or created_at>=since_date)
    ), per_user as (
        select p.is_pro,p.platform,
            case when coalesce(a.n,0)=0 then '0' else case
                when coalesce(a.n,0) between 1 and 5 then '1-5'
                when coalesce(a.n,0) between 6 and 10 then '6-10'
                when coalesce(a.n,0) between 11 and 50 then '11-50'
                when coalesce(a.n,0) between 51 and 200 then '51-200'
                when coalesce(a.n,0) between 201 and 500 then '201-500'
                when coalesce(a.n,0) between 501 and 1000 then '501-1000'
                else '1000+'
            end end as bucket,
            case when coalesce(a.n,0)=0 then 0 else case
                when coalesce(a.n,0) between 1 and 5 then 1
                when coalesce(a.n,0) between 6 and 10 then 2
                when coalesce(a.n,0) between 11 and 50 then 3
                when coalesce(a.n,0) between 51 and 200 then 4
                when coalesce(a.n,0) between 201 and 500 then 5
                when coalesce(a.n,0) between 501 and 1000 then 6
                else 7
            end end as sort_order
        from base p left join activity a on a.user_id=p.id
    ), counts as (
        select s.scope,p.bucket,p.sort_order,
            count(*) filter(where p.is_pro=true)::bigint as pro,
            count(*) filter(where p.is_pro is null or p.is_pro=false)::bigint as free,
            count(*)::bigint as total
        from per_user p cross join lateral (values ('all'::text),(p.platform)) s(scope)
        where s.scope in ('all','ios','android')
        group by s.scope,p.bucket,p.sort_order
    ), rows as (
        select scope,bucket,sort_order,pro,free,total from counts
        union all
        select s.scope,'0',0,0,0,0 from unnest(array['all','ios','android']) s(scope)
        where not exists(select 1 from counts c where c.scope=s.scope and c.bucket='0')
    ), slices as (
        select scope,jsonb_agg(jsonb_build_object('bucket',bucket,'sort_order',sort_order,'pro',pro,'free',free,'total',total) order by sort_order) as data
        from rows group by scope
    ) select jsonb_object_agg(scope,data) into result from slices;
    return result;
end;
$function$;


revoke all on function public.learned_characters_histogram_platforms(timestamptz) from public,anon;
grant execute on function public.learned_characters_histogram_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.notification_tap_stats_platforms(since_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
    platform_scope text;
    platform_results jsonb := '{}'::jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    foreach platform_scope in array array[null::text,'ios','android'] loop
    with taps as (
        select
            ce.user_id,
            coalesce(ce.props->>'type', 'unknown') as type
        from public.client_events ce
        where ce.event = 'push_notification_tapped'
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
        join public.profiles p on p.id = u.user_id
        where p.is_beta = false
          and (since_date is null or p.created_at >= since_date)
          and (platform_scope is null or p.platform = platform_scope)
        group by u.type
    ),
    none_row as (
        select
            'No taps recorded' as type,
            count(*) filter (where p.is_pro = true)::bigint as pro,
            count(*) filter (where p.is_pro is null or p.is_pro = false)::bigint as free,
            count(*)::bigint as total,
            0 as sort_bucket
        from public.profiles p
        where p.is_beta = false
          and (since_date is null or p.created_at >= since_date)
          and (platform_scope is null or p.platform = platform_scope)
          and not exists (select 1 from taps t where t.user_id = p.id)
    )
    select coalesce(jsonb_agg(row_to_json(t) order by t.sort_bucket, t.total desc), '[]'::jsonb) into result
    from (
        select type, pro, free, total, sort_bucket from none_row
        union all
        select type, pro, free, total, sort_bucket from by_type
    ) t;
    platform_results := platform_results || jsonb_build_object(coalesce(platform_scope,'all'),result);
    end loop;
    return platform_results;
end;
$function$;

revoke all on function public.notification_tap_stats_platforms(timestamptz) from public,anon;
grant execute on function public.notification_tap_stats_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.profile_distributions_platforms(since_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
    platform_scope text;
    platform_results jsonb := '{}'::jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    foreach platform_scope in array array[null::text,'ios','android'] loop
    with base as materialized (
        select
            is_pro,
            platform,
            hsk_level,
            theme,
            use_traditional,
            reading_hours,
            survey_responses,
            selected_categories,
            timezone,
            daily_sentence_count,
            show_pinyin
        from public.profiles
        where is_beta = false
          and (since_date is null or created_at >= since_date)
          and (platform_scope is null or platform = platform_scope)
    ),
    pool_row as (
        select
            count(*) filter (where is_pro = true)::int as pro,
            count(*) filter (where is_pro is null or is_pro = false)::int as free,
            count(*)::int as total
        from base
    )
    select jsonb_build_object(
        'pool', (select row_to_json(pool_row) from pool_row),
        'platform', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select coalesce(platform, 'unknown') as key, is_pro, count(*)::int as n
            from base group by 1, 2
        ) t),
        'hsk_level', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select hsk_level as key, is_pro, count(*)::int as n
            from base where hsk_level is not null group by 1, 2
        ) t),
        'theme', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select coalesce(theme, 'unknown') as key, is_pro, count(*)::int as n
            from base group by 1, 2
        ) t),
        'use_traditional', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select use_traditional as key, is_pro, count(*)::int as n
            from base where use_traditional is not null group by 1, 2
        ) t),
        'reading_hours', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select coalesce(reading_hours, survey_responses->>'reading_hours') as key,
                   is_pro, count(*)::int as n
            from base
            where coalesce(reading_hours, survey_responses->>'reading_hours') is not null
            group by 1, 2
        ) t),
        'age_range', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select coalesce(nullif(btrim(survey_responses->>'age_range'), ''), 'Not provided') as key,
                   is_pro, count(*)::int as n
            from base group by 1, 2
        ) t),
        'reason', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select survey_responses->>'reason' as key, is_pro, count(*)::int as n
            from base where survey_responses->>'reason' is not null group by 1, 2
        ) t),
        'referral', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select survey_responses->>'referral_source' as key, is_pro, count(*)::int as n
            from base where survey_responses->>'referral_source' is not null group by 1, 2
        ) t),
        'category', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select unnest(selected_categories) as key, is_pro, count(*)::int as n
            from base where selected_categories is not null group by 1, 2
        ) t),
        'timezone', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select coalesce(timezone, 'unknown') as key, is_pro, count(*)::int as n
            from base group by 1, 2
        ) t),
        'daily_sentence_count', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select daily_sentence_count as key, count(*)::int as n
            from base where is_pro = true and daily_sentence_count is not null group by 1
        ) t),
        'show_pinyin', (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
            select show_pinyin as key, count(*)::int as n
            from base where is_pro = true group by 1
        ) t)
    ) into result;
    platform_results := platform_results || jsonb_build_object(coalesce(platform_scope,'all'),result);
    end loop;
    return platform_results;
end;
$function$;

revoke all on function public.profile_distributions_platforms(timestamptz) from public,anon;
grant execute on function public.profile_distributions_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.saved_characters_histogram_platforms(since_date timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public as $function$
declare result jsonb;
begin
    if not public.is_staff() then raise exception 'not authorized'; end if;
    -- Scan activity once, then expand the cohort into combined and OS slices.
    with activity as materialized (
        select user_id, count(*) as n
        from public.user_saved_characters
        group by user_id
    ), base as materialized (
        select id,is_pro,platform from public.profiles
        where is_beta=false and (since_date is null or created_at>=since_date)
    ), per_user as (
        select p.is_pro,p.platform,
            case when coalesce(a.n,0)=0 then '0' else case
                when coalesce(a.n,0) between 1 and 10 then '1-10'
                when coalesce(a.n,0) between 11 and 50 then '11-50'
                when coalesce(a.n,0) between 51 and 200 then '51-200'
                when coalesce(a.n,0) between 201 and 500 then '201-500'
                when coalesce(a.n,0) between 501 and 1000 then '501-1000'
                else '1000+'
            end end as bucket,
            case when coalesce(a.n,0)=0 then 0 else case
                when coalesce(a.n,0) between 1 and 10 then 1
                when coalesce(a.n,0) between 11 and 50 then 2
                when coalesce(a.n,0) between 51 and 200 then 3
                when coalesce(a.n,0) between 201 and 500 then 4
                when coalesce(a.n,0) between 501 and 1000 then 5
                else 6
            end end as sort_order
        from base p left join activity a on a.user_id=p.id
    ), counts as (
        select s.scope,p.bucket,p.sort_order,
            count(*) filter(where p.is_pro=true)::bigint as pro,
            count(*) filter(where p.is_pro is null or p.is_pro=false)::bigint as free,
            count(*)::bigint as total
        from per_user p cross join lateral (values ('all'::text),(p.platform)) s(scope)
        where s.scope in ('all','ios','android')
        group by s.scope,p.bucket,p.sort_order
    ), rows as (
        select scope,bucket,sort_order,pro,free,total from counts
        union all
        select s.scope,'0',0,0,0,0 from unnest(array['all','ios','android']) s(scope)
        where not exists(select 1 from counts c where c.scope=s.scope and c.bucket='0')
    ), slices as (
        select scope,jsonb_agg(jsonb_build_object('bucket',bucket,'sort_order',sort_order,'pro',pro,'free',free,'total',total) order by sort_order) as data
        from rows group by scope
    ) select jsonb_object_agg(scope,data) into result from slices;
    return result;
end;
$function$;


revoke all on function public.saved_characters_histogram_platforms(timestamptz) from public,anon;
grant execute on function public.saved_characters_histogram_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.sentences_read_histogram_platforms(since_date timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public as $function$
declare result jsonb;
begin
    if not public.is_staff() then raise exception 'not authorized'; end if;
    -- Scan activity once, then expand the cohort into combined and OS slices.
    with base as materialized (
        select id,is_pro,platform from public.profiles
        where is_beta=false and (since_date is null or created_at>=since_date)
    ), activity as materialized (
        -- Indexed lookups avoid scanning unrelated users for recent cohorts.
        select b.id as user_id,
            (select count(*) from public.daily_sentences d where d.user_id=b.id and d.read_at is not null) as n
        from base b where since_date is not null
        union all
        -- All-time cohorts are cheaper as one read-index pass.
        select d.user_id,count(*) as n from public.daily_sentences d
        where since_date is null and d.read_at is not null group by d.user_id
    ), per_user as (
        select p.is_pro,p.platform,
            case when coalesce(a.n,0)=0 then '0' else case
                when coalesce(a.n,0) between 1 and 5 then '1-5'
                when coalesce(a.n,0) between 6 and 20 then '6-20'
                when coalesce(a.n,0) between 21 and 50 then '21-50'
                when coalesce(a.n,0) between 51 and 100 then '51-100'
                when coalesce(a.n,0) between 101 and 500 then '101-500'
                else '500+'
            end end as bucket,
            case when coalesce(a.n,0)=0 then 0 else case
                when coalesce(a.n,0) between 1 and 5 then 1
                when coalesce(a.n,0) between 6 and 20 then 2
                when coalesce(a.n,0) between 21 and 50 then 3
                when coalesce(a.n,0) between 51 and 100 then 4
                when coalesce(a.n,0) between 101 and 500 then 5
                else 6
            end end as sort_order
        from base p left join activity a on a.user_id=p.id
    ), counts as (
        select s.scope,p.bucket,p.sort_order,
            count(*) filter(where p.is_pro=true)::bigint as pro,
            count(*) filter(where p.is_pro is null or p.is_pro=false)::bigint as free,
            count(*)::bigint as total
        from per_user p cross join lateral (values ('all'::text),(p.platform)) s(scope)
        where s.scope in ('all','ios','android')
        group by s.scope,p.bucket,p.sort_order
    ), rows as (
        select scope,bucket,sort_order,pro,free,total from counts
        union all
        select s.scope,'0',0,0,0,0 from unnest(array['all','ios','android']) s(scope)
        where not exists(select 1 from counts c where c.scope=s.scope and c.bucket='0')
    ), slices as (
        select scope,jsonb_agg(jsonb_build_object('bucket',bucket,'sort_order',sort_order,'pro',pro,'free',free,'total',total) order by sort_order) as data
        from rows group by scope
    ) select jsonb_object_agg(scope,data) into result from slices;
    return result;
end;
$function$;


revoke all on function public.sentences_read_histogram_platforms(timestamptz) from public,anon;
grant execute on function public.sentences_read_histogram_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.stories_read_histogram_platforms(since_date timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public as $function$
declare result jsonb;
begin
    if not public.is_staff() then raise exception 'not authorized'; end if;
    -- Scan activity once, then expand the cohort into combined and OS slices.
    with activity as materialized (
        select user_id, count(*) as n
        from public.user_paragraph_assignments
        where read_at is not null
        group by user_id
    ), base as materialized (
        select id,is_pro,platform from public.profiles
        where is_beta=false and (since_date is null or created_at>=since_date)
    ), per_user as (
        select p.is_pro,p.platform,
            case when coalesce(a.n,0)=0 then '0' else case
                when coalesce(a.n,0) between 1 and 2 then '1-2'
                when coalesce(a.n,0) between 3 and 5 then '3-5'
                when coalesce(a.n,0) between 6 and 10 then '6-10'
                when coalesce(a.n,0) between 11 and 25 then '11-25'
                when coalesce(a.n,0) between 26 and 50 then '26-50'
                else '50+'
            end end as bucket,
            case when coalesce(a.n,0)=0 then 0 else case
                when coalesce(a.n,0) between 1 and 2 then 1
                when coalesce(a.n,0) between 3 and 5 then 2
                when coalesce(a.n,0) between 6 and 10 then 3
                when coalesce(a.n,0) between 11 and 25 then 4
                when coalesce(a.n,0) between 26 and 50 then 5
                else 6
            end end as sort_order
        from base p left join activity a on a.user_id=p.id
    ), counts as (
        select s.scope,p.bucket,p.sort_order,
            count(*) filter(where p.is_pro=true)::bigint as pro,
            count(*) filter(where p.is_pro is null or p.is_pro=false)::bigint as free,
            count(*)::bigint as total
        from per_user p cross join lateral (values ('all'::text),(p.platform)) s(scope)
        where s.scope in ('all','ios','android')
        group by s.scope,p.bucket,p.sort_order
    ), rows as (
        select scope,bucket,sort_order,pro,free,total from counts
        union all
        select s.scope,'0',0,0,0,0 from unnest(array['all','ios','android']) s(scope)
        where not exists(select 1 from counts c where c.scope=s.scope and c.bucket='0')
    ), slices as (
        select scope,jsonb_agg(jsonb_build_object('bucket',bucket,'sort_order',sort_order,'pro',pro,'free',free,'total',total) order by sort_order) as data
        from rows group by scope
    ) select jsonb_object_agg(scope,data) into result from slices;
    return result;
end;
$function$;


revoke all on function public.stories_read_histogram_platforms(timestamptz) from public,anon;
grant execute on function public.stories_read_histogram_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.widget_install_breakdown_platforms(since_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
    platform_scope text;
    platform_results jsonb := '{}'::jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    foreach platform_scope in array array[null::text,'ios','android'] loop
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
          and (since_date is null or p.created_at >= since_date)
          and (platform_scope is null or p.platform = platform_scope)
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
    platform_results := platform_results || jsonb_build_object(coalesce(platform_scope,'all'),result);
    end loop;
    return platform_results;
end;
$function$;

revoke all on function public.widget_install_breakdown_platforms(timestamptz) from public,anon;
grant execute on function public.widget_install_breakdown_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.widget_install_stats_platforms(since_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
    platform_scope text;
    platform_results jsonb := '{}'::jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    foreach platform_scope in array array[null::text,'ios','android'] loop
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
          and (since_date is null or p.created_at >= since_date)
          and (platform_scope is null or p.platform = platform_scope)
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
          and (since_date is null or created_at >= since_date)
          and (platform_scope is null or platform = platform_scope)
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
    platform_results := platform_results || jsonb_build_object(coalesce(platform_scope,'all'),result);
    end loop;
    return platform_results;
end;
$function$;

revoke all on function public.widget_install_stats_platforms(timestamptz) from public,anon;
grant execute on function public.widget_install_stats_platforms(timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.widget_tap_stats_platforms(since_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    result jsonb;
    platform_scope text;
    platform_results jsonb := '{}'::jsonb;
begin
    if not public.is_staff() then
        raise exception 'not authorized';
    end if;
    foreach platform_scope in array array[null::text,'ios','android'] loop
    with taps as (
        select user_id, count(*) as n
        from public.client_events
        where event = 'widget_tapped'
        group by user_id
    ),
    user_totals as (
        select coalesce(t.n, 0) as tap_count, p.is_pro
        from public.profiles p
        left join taps t on t.user_id = p.id
        where p.is_beta = false
          and (since_date is null or p.created_at >= since_date)
          and (platform_scope is null or p.platform = platform_scope)
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
    platform_results := platform_results || jsonb_build_object(coalesce(platform_scope,'all'),result);
    end loop;
    return platform_results;
end;
$function$;

revoke all on function public.widget_tap_stats_platforms(timestamptz) from public,anon;
grant execute on function public.widget_tap_stats_platforms(timestamptz) to authenticated;

-- This staff-only, one-time payload can exceed the normal 8-second request
-- budget on large cohorts. PostgREST hoists this per-function bound; platform
-- changes never execute it again. No global or role timeout is changed.
alter function public.sentences_read_histogram_platforms(timestamptz) set statement_timeout='55s';
notify pgrst, 'reload schema';

-- The dashboard's user badge needs only counts, not full all-time distributions.
create or replace function public.admin_profile_counts_platforms()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
    if not public.is_staff() then raise exception 'not authorized'; end if;
    with counts as (
        select scope,
            count(*) filter(where is_pro=true) as pro,
            count(*) filter(where is_pro is null or is_pro=false) as free,
            count(*) as total
        from public.profiles p cross join lateral (values ('all'::text),(p.platform)) s(scope)
        where p.is_beta=false and scope in ('all','ios','android') group by scope
    ) select jsonb_object_agg(s.scope,jsonb_build_object('pool',jsonb_build_object('pro',coalesce(c.pro,0),'free',coalesce(c.free,0),'total',coalesce(c.total,0)))) into result
      from unnest(array['all','ios','android']) s(scope) left join counts c using(scope);
    return result;
end;
$$;
revoke all on function public.admin_profile_counts_platforms() from public,anon;
grant execute on function public.admin_profile_counts_platforms() to authenticated;

-- Avoid JIT compilation overhead for these dashboard aggregation payloads.
do $$
declare fn text;
begin
    foreach fn in array array['profile_distributions','sentences_read_histogram','stories_read_histogram','saved_characters_histogram','learned_characters_histogram','in_review_characters_histogram','widget_install_stats','widget_install_breakdown','widget_tap_stats','notification_tap_stats'] loop
        execute format('alter function public.%I(timestamptz) set jit=off',fn||'_platforms');
    end loop;
end;
$$;
alter function public.profile_distributions_platforms(timestamptz) set statement_timeout='55s';
notify pgrst, 'reload schema';

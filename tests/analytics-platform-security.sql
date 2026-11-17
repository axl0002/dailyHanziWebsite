-- Read-only checks under a rolled-back JWT context; no application rows change.
begin;
do $check$
declare fn text; denied boolean; staff uuid; payload jsonb; expected bigint;
begin
    foreach fn in array array['profile_distributions','sentences_read_histogram','stories_read_histogram','saved_characters_histogram','learned_characters_histogram','in_review_characters_histogram','widget_install_stats','widget_install_breakdown','widget_tap_stats','notification_tap_stats'] loop
        if has_function_privilege('anon',format('public.%I(timestamptz)',fn||'_platforms'),'execute') then
            raise exception 'Anonymous access granted to %',fn;
        end if;
        perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
        denied:=false;
        begin execute format('select public.%I(null)',fn||'_platforms');
        exception when raise_exception then
            if sqlerrm='not authorized' then denied:=true; else raise; end if;
        end;
        if not denied then raise exception 'Nonstaff analytics access allowed: %',fn; end if;
    end loop;
    select user_id into staff from public.user_roles where role::text='admin' limit 1;
    if staff is null then raise exception 'No admin available for validation'; end if;
    perform set_config('request.jwt.claim.sub',staff::text,true);
    payload:=public.profile_distributions_platforms(null);
    select count(*) into expected from public.profiles where is_beta=false;
    if (payload->'all'->'pool'->>'total')::bigint<>expected then raise exception 'Combined pool changed'; end if;
    select count(*) into expected from public.profiles where is_beta=false and platform='ios';
    if (payload->'ios'->'pool'->>'total')::bigint<>expected then raise exception 'iOS pool is wrong'; end if;
    select count(*) into expected from public.profiles where is_beta=false and platform='android';
    if (payload->'android'->'pool'->>'total')::bigint<>expected then raise exception 'Android pool is wrong'; end if;
end;
$check$;
rollback;

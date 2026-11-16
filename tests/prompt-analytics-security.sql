begin;
do $check$
declare staff uuid; result jsonb; denied boolean := false; assigned_total bigint;
begin
    if has_function_privilege('anon','public.admin_daily_prompt_analytics(date,date,text)','execute') then
        raise exception 'Anonymous analytics access was granted';
    end if;
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    begin perform public.admin_daily_prompt_analytics(current_date-29,current_date,null);
    exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Nonstaff analytics access was allowed'; end if;
    select user_id into staff from public.user_roles where role::text in ('admin','moderator') limit 1;
    if staff is null then raise exception 'No staff account for validation'; end if;
    perform set_config('request.jwt.claim.sub',staff::text,true);
    result:=public.admin_daily_prompt_analytics(current_date-29,current_date,null);
    select coalesce(sum((r->>'assigned')::bigint),0) into assigned_total from jsonb_array_elements(result) r;
    if assigned_total <> (select count(*) from public.social_prompt_assignments where prompt_date between current_date-29 and current_date) then
        raise exception 'Assignments were lost or duplicated by response join';
    end if;
    if exists (select 1 from jsonb_array_elements(result) r where (r->>'responded')::bigint > (r->>'assigned')::bigint) then
        raise exception 'Response numerator exceeds assignments';
    end if;
    if exists (select 1 from jsonb_array_elements(public.admin_daily_prompt_analytics(current_date-29,current_date,'voice')) r where r->>'response_type'<>'voice') then
        raise exception 'Type filter was ignored';
    end if;
    denied:=false;
    begin perform public.admin_daily_prompt_analytics(current_date-400,current_date,null);
    exception when invalid_parameter_value then denied:=true; end;
    if not denied then raise exception 'Unbounded query was allowed'; end if;
end;
$check$;
rollback;

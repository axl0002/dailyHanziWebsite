-- No Google requests. All synthetic audit fixtures are rolled back. Run as DB owner.
begin;
do $check$
declare actor uuid; denied boolean;
begin
 select user_id into actor from public.user_roles where role::text in ('admin','moderator') limit 1;
 if actor is null then raise exception 'No staff account is available for security checks'; end if;
 if has_function_privilege('authenticated','public.reserve_play_refund(uuid,text,text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.reserve_play_refund(uuid,text,text,uuid,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_play_refund_auth_attempt(uuid)','EXECUTE')
    or has_table_privilege('service_role','public.play_refunds','DELETE')
    or has_table_privilege('service_role','public.play_refunds','INSERT')
    or has_column_privilege('service_role','public.play_refunds','created_at','UPDATE')
    or has_column_privilege('service_role','public.play_refunds','actor_id','UPDATE') then
  raise exception 'Refund security ACL check failed';
 end if;
 -- A normal user ID must fail even when a privileged server calls the function.
 denied:=false;
 begin perform public.reserve_play_refund(gen_random_uuid(),'security.test','GPA.0000-0000-0000-99999',null,'{}'::jsonb);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Non-staff reservation was allowed'; end if;
 -- Each isolated fixture is rolled back with its own subtransaction.
 begin
  insert into public.play_refunds(package_name,order_id,actor_id,status,order_total,created_at)
  select 'security.test','GPA.0000-0000-0000-00000..'||i,actor,'processing','{}'::jsonb,now()-interval '2 minutes' from generate_series(1,3) i;
  denied:=false;
  begin perform public.reserve_play_refund(actor,'security.test','GPA.0000-0000-0000-99999',null,'{}'::jsonb);
  exception when raise_exception then if sqlerrm='REFUND_LIMIT_REACHED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'Actor budget was bypassed'; end if;
  raise exception using errcode='Z0001',message='Rollback test fixture';
 exception when sqlstate 'Z0001' then null; end;
 begin
  insert into public.play_refunds(package_name,order_id,actor_id,status,order_total,created_at)
  select 'security.test','GPA.0000-0000-0000-00000..'||i,gen_random_uuid(),'processing','{}'::jsonb,now()-interval '2 minutes' from generate_series(1,5) i;
  denied:=false;
  begin perform public.reserve_play_refund(actor,'security.test','GPA.0000-0000-0000-99999',null,'{}'::jsonb);
  exception when raise_exception then if sqlerrm='REFUND_LIMIT_REACHED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'Global budget was bypassed'; end if;
  raise exception using errcode='Z0001',message='Rollback test fixture';
 exception when sqlstate 'Z0001' then null; end;
 begin
  perform public.reserve_play_refund(actor,'security.test','GPA.0000-0000-0000-00001',null,'{}'::jsonb);
  denied:=false;
  begin perform public.reserve_play_refund(actor,'security.test','GPA.0000-0000-0000-00002',null,'{}'::jsonb);
  exception when raise_exception then if sqlerrm='REFUND_LIMIT_REACHED' then denied:=true; else raise; end if; end;
  if not denied then raise exception 'Cooldown was bypassed'; end if;
  raise exception using errcode='Z0001',message='Rollback test fixture';
 exception when sqlstate 'Z0001' then null; end;
 begin
  insert into public.play_refunds(package_name,order_id,actor_id,status,order_total,created_at)
  values('security.test','GPA.0000-0000-0000-00001',actor,'processing','{}'::jsonb,now()-interval '2 minutes');
  denied:=false;
  begin perform public.reserve_play_refund(actor,'security.test','GPA.0000-0000-0000-00001',null,'{}'::jsonb);
  exception when unique_violation then denied:=true; end;
  if not denied then raise exception 'Duplicate order lock was bypassed'; end if;
  raise exception using errcode='Z0001',message='Rollback test fixture';
 exception when sqlstate 'Z0001' then null; end;
 begin
  insert into public.play_refund_auth_attempts(actor_id) select actor from generate_series(1,5);
  if public.claim_play_refund_auth_attempt(actor) then raise exception 'Password attempt budget was bypassed'; end if;
  raise exception using errcode='Z0001',message='Rollback test fixture';
 exception when sqlstate 'Z0001' then null; end;
end;
$check$;
rollback;

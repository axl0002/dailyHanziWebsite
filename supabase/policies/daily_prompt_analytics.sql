-- Content-free assignment-cohort analytics for staff. No response text/media/user IDs leave the DB.
create or replace function public.admin_daily_prompt_analytics(p_start date, p_end date, p_type text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
    if not exists (select 1 from public.user_roles where user_id=auth.uid() and role::text in ('admin','moderator')) then
        raise exception 'Staff access required' using errcode='42501';
    end if;
    if p_start is null or p_end is null or p_end < p_start or p_end-p_start > 365
       or (p_type is not null and p_type not in ('handwriting','photo','sentence','voice')) then
        raise exception 'Invalid analytics range or type' using errcode='22023';
    end if;
    select coalesce(jsonb_agg(to_jsonb(stats) order by stats.date,stats.prompt_id),'[]'::jsonb) into result
    from (
        select a.prompt_date as date,a.prompt_id,p.title,p.slug,a.response_type,
               count(*) as assigned,count(r.id) as responded
        from public.social_prompt_assignments a
        join public.social_prompts p on p.id=a.prompt_id
        left join public.social_v2_responses r on r.assignment_id=a.id
            and r.user_id=a.user_id and r.prompt_date=a.prompt_date and r.response_type=a.response_type
        where a.prompt_date between p_start and p_end and (p_type is null or a.response_type=p_type)
        group by a.prompt_date,a.prompt_id,p.title,p.slug,a.response_type
    ) stats;
    return result;
end;
$$;
revoke all on function public.admin_daily_prompt_analytics(date,date,text) from public,anon;
grant execute on function public.admin_daily_prompt_analytics(date,date,text) to authenticated;

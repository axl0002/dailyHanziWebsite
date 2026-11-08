-- Run in each app project after play_refunds.sql. Limits are enforced inside
-- one DB transaction, across concurrent API instances. No Google calls here.
create index if not exists play_refunds_actor_created on public.play_refunds(actor_id, created_at);
create index if not exists play_refunds_created on public.play_refunds(created_at);
create table if not exists public.play_refund_auth_attempts (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid not null,
    created_at timestamptz not null default now()
);
create index if not exists play_refund_auth_actor_created on public.play_refund_auth_attempts(actor_id, created_at);
create index if not exists play_refund_auth_created on public.play_refund_auth_attempts(created_at);
alter table public.play_refund_auth_attempts enable row level security;
revoke all on public.play_refund_auth_attempts from public, anon, authenticated, service_role;

-- The service key can read audit rows and finalize outcomes, but cannot delete,
-- insert directly, or alter actor/order/timestamp fields to evade the budgets.
revoke all on public.play_refunds from public, anon, authenticated, service_role;
grant select on public.play_refunds to service_role;
grant update (status, refund_total, warnings, completed_at) on public.play_refunds to service_role;

create or replace function public.claim_play_refund_auth_attempt(p_actor_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.user_roles where user_id=p_actor_id and role::text in ('admin','moderator')) then
        raise exception 'Staff role required' using errcode='42501';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('play-refund-auth-budget',0));
    if (select count(*) from public.play_refund_auth_attempts where actor_id=p_actor_id and created_at > now()-interval '10 minutes') >= 5
       or (select count(*) from public.play_refund_auth_attempts where created_at > now()-interval '10 minutes') >= 25 then
        return false;
    end if;
    insert into public.play_refund_auth_attempts(actor_id) values(p_actor_id);
    return true;
end;
$$;
revoke all on function public.claim_play_refund_auth_attempt(uuid) from public, anon, authenticated;
grant execute on function public.claim_play_refund_auth_attempt(uuid) to service_role;

create or replace function public.reserve_play_refund(
    p_actor_id uuid, p_package_name text, p_order_id text, p_user_id uuid, p_order_total jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare result uuid;
begin
    if not exists (select 1 from public.user_roles where user_id=p_actor_id and role::text in ('admin','moderator')) then
        raise exception 'Staff role required' using errcode='42501';
    end if;
    if p_package_name is null or p_order_id is null or p_order_id !~ '^GPA\.[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{5}(\.\.[0-9]+)?$' or p_order_total is null then
        raise exception 'Invalid refund reservation' using errcode='22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('play-refund-global-budget',0));
    if (select count(*) from public.play_refunds where created_at > now()-interval '24 hours') >= 5
       or (select count(*) from public.play_refunds where actor_id=p_actor_id and created_at > now()-interval '24 hours') >= 3
       or exists (select 1 from public.play_refunds where actor_id=p_actor_id and created_at > now()-interval '60 seconds') then
        raise exception 'REFUND_LIMIT_REACHED' using errcode='P0001';
    end if;
    insert into public.play_refunds(package_name,order_id,actor_id,user_id,status,order_total)
    values(p_package_name,p_order_id,p_actor_id,p_user_id,'processing',p_order_total) returning id into result;
    return result;
end;
$$;
revoke all on function public.reserve_play_refund(uuid,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_play_refund(uuid,text,text,uuid,jsonb) to service_role;

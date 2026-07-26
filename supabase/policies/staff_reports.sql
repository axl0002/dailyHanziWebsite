-- Staff (admin + moderator) RLS policies for the admin report pages.
--
-- Apply by pasting into the Supabase SQL editor. This repo does not track
-- migrations, so this file is documentation of the live policies — keep it in
-- sync when you change them. Safe to re-run (each policy is dropped/recreated).
--
-- Context: moderators can use /admin/sentence-reports and /admin/character-reports
-- but are blocked from the dashboard (enforced in middleware.ts). These policies
-- grant a moderator's session the table access those report pages need.
--
-- DO NOT add `alter table ... enable row level security` here. Tables like
-- characters / example_sentences / categories are read by the public app; these
-- policies only ADD staff access where RLS is already enabled, and are harmless
-- no-ops where it is not. Enabling RLS on a public table would break the app.

-- Helper: is the current user staff (admin or moderator)?
-- SECURITY DEFINER so it can read user_roles even though that table has its own RLS.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('admin', 'moderator')
  );
$$;

-- Reports: staff can list and delete them (this is what fixes the blank list)
drop policy if exists staff_all_sentence_reports on public.sentence_reports;
create policy staff_all_sentence_reports on public.sentence_reports
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists staff_all_character_reports on public.character_reports;
create policy staff_all_character_reports on public.character_reports
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Reporter info (email / timezone) shown next to each report.
-- NOTE: RLS is row-level, not column-level, so this also lets a moderator read
-- is_pro and other profile columns directly. Consistent with the UI-only gate.
-- To avoid that, drop this policy and serve reporter info via a SECURITY DEFINER
-- RPC that returns only id/email/timezone instead.
drop policy if exists staff_select_profiles on public.profiles;
create policy staff_select_profiles on public.profiles
  for select to authenticated using (public.is_staff());

-- Fixing / removing the reported content
drop policy if exists staff_all_characters on public.characters;
create policy staff_all_characters on public.characters
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists staff_all_example_sentences on public.example_sentences;
create policy staff_all_example_sentences on public.example_sentences
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists staff_select_categories on public.categories;
create policy staff_select_categories on public.categories
  for select to authenticated using (public.is_staff());

-- Account deletion requests: staff list them on /admin/deletion-requests and
-- mark them processed after removing the user.
drop policy if exists staff_all_deletion_requests on public.deletion_requests;
create policy staff_all_deletion_requests on public.deletion_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Feedback: staff read user feedback on /admin/feedback.
drop policy if exists staff_select_feedback on public.feedback;
create policy staff_select_feedback on public.feedback
  for select to authenticated using (public.is_staff());

-- Trial cancellation charts on the admin dashboard read RevenueCat events.
drop policy if exists staff_select_subscription_events on public.subscription_events;
create policy staff_select_subscription_events on public.subscription_events
  for select to authenticated using (public.is_staff());

-- Server-side aggregation for every distribution chart on /admin/analytics
-- (and the dashboard mirror). Replaces the old client-side approach of
-- fetching all 197k non-beta profiles and reducing in JS — that broke once
-- offset scans past ~100k rows started timing out at ~30s per PostgREST page.
--
-- One RPC does all the group-bys in a single query with a materialized CTE
-- so profiles is scanned once (~2s cold on the 30d slice), then each
-- additional aggregation is ~20ms. Total wall clock ~2.5s regardless of how
-- many charts render.
--
-- Response shape:
--   {
--     "pool":                {pro, free, total},
--     "platform":            [{key, is_pro, n}, ...],
--     "hsk_level":           [{key, is_pro, n}, ...],
--     "theme":               [{key, is_pro, n}, ...],
--     "use_traditional":     [...],
--     "reading_hours":       [...],
--     "reason":              [...],
--     "referral":            [...],
--     "category":            [...],   -- unnested selected_categories
--     "timezone":            [...],   -- client derives continent + country
--     "daily_sentence_count":[{key, n}, ...],   -- Pro-only post-paywall
--     "show_pinyin":         [{key, n}, ...]    -- Pro-only post-paywall
--   }
--
-- since_date filters by profiles.created_at (matches the old
-- filterProfiles() cutoff semantics).

drop function if exists public.profile_distributions(timestamptz);

create or replace function public.profile_distributions(
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
    return result;
end;
$$;

revoke all on function public.profile_distributions(timestamptz) from public;
grant execute on function public.profile_distributions(timestamptz) to authenticated;

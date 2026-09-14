"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

// Shared profile cache used by the analytics tab + admin dashboard. Fetches
// all non-beta profiles once on mount and hands them to every distribution
// chart so we're not doing 14× the same full-table scan. Filter/date-range
// selectors then just slice in memory.
//
// Columns selected here are the union of what every distribution chart
// needs. Adding a chart? Extend CachedProfile + the .select() together.

export type CachedProfile = {
    id: string;
    is_pro: boolean | null;
    created_at: string;
    platform: string | null;
    hsk_level: number | null;
    survey_responses: {
        reason?: string;
        reading_hours?: string;
        referral_source?: string;
        goal?: number | string;
        level?: number | string;
        categories?: string[];
    } | null;
    selected_categories: string[] | null;
    reading_hours: string | null;
    timezone: string | null;
    theme: string | null;
    use_traditional: boolean | null;
    daily_sentence_count: number | null;
};

const PROFILE_SELECT =
    'id, is_pro, created_at, platform, hsk_level, survey_responses, ' +
    'selected_categories, reading_hours, timezone, theme, use_traditional, ' +
    'daily_sentence_count';

type Ctx = {
    profiles: CachedProfile[] | null;
    loading: boolean;
    error: string | null;
};

const ProfilesCacheContext = createContext<Ctx>({
    profiles: null,
    loading: true,
    error: null,
});

export function ProfilesCacheProvider({ children }: { children: ReactNode }) {
    const [profiles, setProfiles] = useState<CachedProfile[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const fetchAll = async () => {
            setLoading(true);
            setError(null);
            try {
                // 1) Head-only request to learn the total row count (Content-Range).
                const { count, error: countErr } = await supabase
                    .from('profiles')
                    .select('id', { count: 'exact', head: true })
                    .eq('is_beta', false);
                if (countErr) throw new Error(countErr.message);
                const total = Math.min(count ?? 0, 500000);
                if (total === 0) {
                    if (!cancelled) setProfiles([]);
                    return;
                }

                // 2) Fire page fetches in parallel batches. PostgREST's per-response
                // db-max-rows on this project is 1000, so 1000 is our page size.
                // Concurrency = 8 keeps us well under Supabase's typical connection
                // pool limits while cutting wall-clock ~8×.
                const pageSize = 1000;
                const concurrency = 8;
                const totalPages = Math.ceil(total / pageSize);
                const results: CachedProfile[][] = new Array(totalPages);

                for (let batchStart = 0; batchStart < totalPages; batchStart += concurrency) {
                    if (cancelled) return;
                    const batch = [];
                    for (let i = batchStart; i < Math.min(batchStart + concurrency, totalPages); i++) {
                        batch.push((async (pageIdx: number) => {
                            const from = pageIdx * pageSize;
                            const to = from + pageSize - 1;
                            const { data, error: qErr } = await supabase
                                .from('profiles')
                                .select(PROFILE_SELECT)
                                .eq('is_beta', false)
                                .order('id', { ascending: true })
                                .range(from, to);
                            if (qErr) throw new Error(qErr.message);
                            results[pageIdx] = (data ?? []) as unknown as CachedProfile[];
                        })(i));
                    }
                    await Promise.all(batch);
                }
                if (cancelled) return;
                const merged: CachedProfile[] = [];
                for (const chunk of results) if (chunk) merged.push(...chunk);
                setProfiles(merged);
            } catch (e: unknown) {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load profiles');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchAll();
        return () => { cancelled = true; };
    }, []);

    return (
        <ProfilesCacheContext.Provider value={{ profiles, loading, error }}>
            {children}
        </ProfilesCacheContext.Provider>
    );
}

export function useProfilesCache() {
    return useContext(ProfilesCacheContext);
}

// Common helper: apply the shared pro/free + date-range filters to the cache.
// Charts call this at the top of their render so they don't each reimplement
// the same predicate.
export type ProFilter = 'all' | 'true' | 'false';
export type DateRange = 'all' | '30d' | '7d';

export function filterProfiles(
    profiles: CachedProfile[] | null,
    filter: ProFilter = 'all',
    dateRange: DateRange = 'all',
): CachedProfile[] {
    if (!profiles) return [];
    const cutoff = dateRange === '7d'
        ? Date.now() - 7 * 86400_000
        : dateRange === '30d'
            ? Date.now() - 30 * 86400_000
            : null;
    return profiles.filter(p => {
        if (filter === 'true' && !p.is_pro) return false;
        if (filter === 'false' && p.is_pro) return false;
        if (cutoff !== null) {
            const t = Date.parse(p.created_at);
            if (Number.isNaN(t) || t < cutoff) return false;
        }
        return true;
    });
}

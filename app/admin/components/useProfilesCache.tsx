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
                const all: CachedProfile[] = [];
                let page = 0;
                const pageSize = 1000;
                while (true) {
                    const from = page * pageSize;
                    const to = from + pageSize - 1;
                    const { data, error: qErr } = await supabase
                        .from('profiles')
                        .select(PROFILE_SELECT)
                        .eq('is_beta', false)
                        .order('id', { ascending: true })
                        .range(from, to);
                    if (qErr) throw new Error(qErr.message);
                    if (!data || data.length === 0) break;
                    all.push(...(data as unknown as CachedProfile[]));
                    if (data.length < pageSize) break;
                    page++;
                    if (all.length > 500000) break; // sanity cap
                    if (cancelled) return;
                }
                if (!cancelled) setProfiles(all);
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

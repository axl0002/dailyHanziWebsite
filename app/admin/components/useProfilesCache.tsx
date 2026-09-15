"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { sinceFromDateRange } from './useRpcData';

// Shared cache of the profile_distributions RPC output — the server does all
// the group-bys against the 197k-row profiles table in a single query
// (materialized CTE + one aggregation per chart), returns a compact jsonb
// object. Each chart reads its own slice + pivots is_pro on the client.
//
// This replaced an earlier approach that paginated 197k profile rows to the
// browser and reduced client-side. That fell apart once profiles grew large
// enough that OFFSET scans past ~100k rows started timing out at ~30s per
// page. See supabase/policies/analytics_profile_distributions.sql for the
// server-side aggregation.

export type ProFilter = 'all' | 'true' | 'false';
export type DateRange = 'all' | '30d' | '7d';

// One row per (key, is_pro) combination. The chart pivots by key and applies
// its own is_pro filter to render pro / free / stacked bars.
export type DistRow<K = string> = { key: K; is_pro: boolean | null; n: number };
// Pro-only distributions (post-paywall settings) drop the is_pro dimension.
export type ProOnlyDistRow<K = string> = { key: K; n: number };

export type Distributions = {
    pool: { pro: number; free: number; total: number };
    platform: DistRow<string>[];
    hsk_level: DistRow<number>[];
    theme: DistRow<string>[];
    use_traditional: DistRow<boolean>[];
    reading_hours: DistRow<string>[];
    reason: DistRow<string>[];
    referral: DistRow<string>[];
    category: DistRow<string>[];
    timezone: DistRow<string>[];  // client derives continent + country from timezone
    daily_sentence_count: ProOnlyDistRow<number>[];
    show_pinyin: ProOnlyDistRow<boolean>[];
};

type Ctx = {
    distributions: Distributions | null;
    loading: boolean;
    error: string | null;
    retry: () => void;
};

const ProfilesCacheContext = createContext<Ctx>({
    distributions: null,
    loading: true,
    error: null,
    retry: () => {},
});

export function ProfilesCacheProvider({ dateRange, children }: { dateRange: DateRange; children: ReactNode }) {
    const [distributions, setDistributions] = useState<Distributions | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    const since = sinceFromDateRange(dateRange);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            const { data: raw, error: rpcErr } = await supabase.rpc('profile_distributions', { since_date: since });
            if (cancelled) return;
            if (rpcErr) {
                console.error('profile_distributions:', rpcErr);
                setError(rpcErr.message ?? 'Failed to load distributions');
                setLoading(false);
                return;
            }
            setDistributions(raw as Distributions);
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [since, tick]);

    const retry = useCallback(() => setTick(t => t + 1), []);

    return (
        <ProfilesCacheContext.Provider value={{ distributions, loading, error, retry }}>
            {children}
        </ProfilesCacheContext.Provider>
    );
}

export function useProfilesCache() {
    return useContext(ProfilesCacheContext);
}

// Pivot server-side (key, is_pro, n) rows into chart-ready
// (name, pro, free, total) rows. Sorted by total desc by default.
// keyLabel lets non-string keys (levels, bools) render as text.
export function pivotDist<K>(
    rows: DistRow<K>[] | undefined,
    opts: { keyLabel?: (k: K) => string; sort?: 'total' | 'key' } = {},
): { name: string; keyValue: K; pro: number; free: number; total: number }[] {
    const label = opts.keyLabel ?? ((k: K) => String(k));
    const map = new Map<string, { name: string; keyValue: K; pro: number; free: number }>();
    for (const r of rows ?? []) {
        const name = label(r.key);
        let entry = map.get(name);
        if (!entry) {
            entry = { name, keyValue: r.key, pro: 0, free: 0 };
            map.set(name, entry);
        }
        if (r.is_pro === true) entry.pro += r.n;
        else entry.free += r.n;
    }
    const out = Array.from(map.values()).map(e => ({
        name: e.name,
        keyValue: e.keyValue,
        pro: e.pro,
        free: e.free,
        total: e.pro + e.free,
    }));
    if (opts.sort === 'key') {
        out.sort((a, b) => String(a.keyValue) < String(b.keyValue) ? -1 : 1);
    } else {
        out.sort((a, b) => b.total - a.total);
    }
    return out;
}

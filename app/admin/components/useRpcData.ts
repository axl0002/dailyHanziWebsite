"use client";

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Shared fetch primitive for the RPC-backed analytics charts (read histograms,
// character histograms, widget/notification stats). Handles the common pattern:
// call supabase.rpc, defensively unwrap {data: [...]} envelopes, expose
// loading/error/data + a retry() the chart can wire to a button.
//
// parseRow runs against each element of the returned array so the caller
// keeps its per-chart Row shape. It's not tracked in deps — we intentionally
// let the closure capture the latest one at fetch time.

export function useRpcData<T>(
    rpcName: string,
    args: Record<string, unknown>,
    parseRow: (raw: unknown) => T,
): { data: T[]; loading: boolean; error: string | null; retry: () => void } {
    const [data, setData] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    // Stable string key so re-renders with a fresh args object don't re-fetch.
    const argsKey = JSON.stringify(args);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        (async () => {
            const { data: raw, error: rpcErr } = await supabase.rpc(rpcName, args);
            if (cancelled) return;
            if (rpcErr) {
                console.error(`${rpcName}:`, rpcErr);
                setError(rpcErr.message ?? 'RPC failed');
                setLoading(false);
                return;
            }
            const arr = Array.isArray(raw)
                ? raw
                : (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data))
                    ? (raw as { data: unknown[] }).data
                    : [];
            setData(arr.map(parseRow));
            setLoading(false);
        })();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rpcName, argsKey, tick]);

    const retry = useCallback(() => setTick(t => t + 1), []);

    return { data, loading, error, retry };
}

// Helper for the standard 'all' | '30d' | '7d' toolbar → ISO since_date arg.
export function sinceFromDateRange(dateRange: 'all' | '30d' | '7d'): string | null {
    if (dateRange === '7d') return new Date(Date.now() - 7 * 86400_000).toISOString();
    if (dateRange === '30d') return new Date(Date.now() - 30 * 86400_000).toISOString();
    return null;
}

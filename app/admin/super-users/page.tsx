"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type SurveyResponses = {
    reason?: string;
    reading_hours?: string;
    referral_source?: string;
    goal?: number | string;
    level?: number | string;
    categories?: string[];
} | null;

type SuperUser = {
    id: string;
    full_name: string | null;
    email: string | null;
    streak_days: number;
    longest_streak_days: number | null;
    is_pro: boolean;
    platform: string | null;
    timezone: string | null;
    created_at: string;
    hsk_level: number | null;
    notifications_enabled: boolean | null;
    daily_goal: number | null;
    survey_responses: SurveyResponses;
    seen_count?: number | null;
};

type SortField =
    | 'streak_days'
    | 'longest_streak_days'
    | 'full_name'
    | 'created_at'
    | 'daily_goal'
    | 'hsk_level'
    | 'seen_count';
type SortOrder = 'asc' | 'desc';
type Mode = 'all' | 'cancelled';

type Filters = {
    hskLevel: string;                    // '' = any
    pro: 'all' | 'pro' | 'free';
    notifications: 'all' | 'on' | 'off';
    platform: string;                    // '' = any
    surveyReason: string;                // '' = any
    surveyReadingHours: string;          // '' = any
    timezoneContains: string;            // '' = any
    minStreak: string;                   // '' = any (numeric input as string)
};

const DEFAULT_FILTERS: Filters = {
    hskLevel: '',
    pro: 'all',
    notifications: 'all',
    platform: '',
    surveyReason: '',
    surveyReadingHours: '',
    timezoneContains: '',
    minStreak: '',
};

const SORT_OPTIONS: { value: SortField; label: string }[] = [
    { value: 'streak_days', label: 'Streak Days' },
    { value: 'longest_streak_days', label: 'Longest Streak' },
    { value: 'seen_count', label: 'Characters Seen' },
    { value: 'daily_goal', label: 'Daily Goal' },
    { value: 'created_at', label: 'Joined' },
    { value: 'full_name', label: 'Name' },
    { value: 'hsk_level', label: 'HSK Level' },
];

// Discovered by querying survey_responses on the live DB. Keeping the option
// list explicit rather than fetching dynamically — the set is stable and small.
const REASON_OPTIONS = ['Education', 'Personal Interest', 'Connect with people', 'Travel', 'Business', 'Heritage', 'Other'];
const READING_HOURS_OPTIONS = ['< 30 mins', '< 1 hour', '1-3 hours', '3-7 hours', '7+ hours'];
const PLATFORM_OPTIONS = ['ios', 'android'];
const HSK_LEVELS = ['1', '2', '3', '4', '5', '6'];

type ColumnKey =
    | 'name'
    | 'email'
    | 'streak_days'
    | 'longest_streak_days'
    | 'seen_count'
    | 'hsk_level'
    | 'daily_goal'
    | 'notifications'
    | 'timezone'
    | 'reading_hours'
    | 'reason'
    | 'platform'
    | 'is_pro'
    | 'created_at';

type ColumnDef = {
    key: ColumnKey;
    label: string;
    defaultVisible: boolean;
};

const COLUMN_DEFS: ColumnDef[] = [
    { key: 'name', label: 'Name', defaultVisible: true },
    { key: 'email', label: 'Email', defaultVisible: true },
    { key: 'streak_days', label: 'Streak', defaultVisible: true },
    { key: 'longest_streak_days', label: 'Longest', defaultVisible: true },
    { key: 'seen_count', label: 'Seen', defaultVisible: true },
    { key: 'hsk_level', label: 'HSK', defaultVisible: true },
    { key: 'daily_goal', label: 'Goal', defaultVisible: false },
    { key: 'notifications', label: 'Notifs', defaultVisible: false },
    { key: 'timezone', label: 'Timezone', defaultVisible: true },
    { key: 'reading_hours', label: 'Reading Hrs', defaultVisible: false },
    { key: 'reason', label: 'Reason', defaultVisible: false },
    { key: 'platform', label: 'Platform', defaultVisible: false },
    { key: 'is_pro', label: 'Status', defaultVisible: true },
    { key: 'created_at', label: 'Joined', defaultVisible: false },
];

type ExportColumn = {
    key: string;
    label: string;
};

const EXPORT_COLUMNS: ExportColumn[] = [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'streak_days', label: 'Streak Days' },
    { key: 'longest_streak_days', label: 'Longest Streak' },
    { key: 'seen_count', label: 'Characters Seen' },
    { key: 'hsk_level', label: 'HSK Level' },
    { key: 'daily_goal', label: 'Daily Goal' },
    { key: 'notifications_enabled', label: 'Notifications' },
    { key: 'timezone', label: 'Timezone' },
    { key: 'reading_hours', label: 'Reading Hours (survey)' },
    { key: 'reason', label: 'Reason (survey)' },
    { key: 'referral_source', label: 'Referral (survey)' },
    { key: 'is_pro', label: 'Status (Pro/Free)' },
    { key: 'platform', label: 'Platform' },
    { key: 'created_at', label: 'Joined' },
    { key: 'id', label: 'User ID' },
];

const EXPORT_HARD_CAP = 50000;
// Cap the seen-count RPC at the same 50K ceiling as the CSV export. The
// underlying aggregation over user_seen_characters takes ~5s regardless of
// LIMIT (measured on the live DB) and fits comfortably under the
// authenticated role's 8s statement_timeout. Payload at 50K is ~38MB —
// heavier than 5K but still a one-shot load cached for the whole session.
const SEEN_RPC_MAX_ROWS = 50000;

// Column list requested from Supabase for the non-seen paths. Kept as one string
// so both the paginated fetch and the cancelled/export fetches use exactly the
// same shape.
const PROFILE_SELECT = 'id, full_name, email, streak_days, longest_streak_days, is_pro, platform, timezone, created_at, hsk_level, notifications_enabled, daily_goal, survey_responses';

function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function surveyValue(user: SuperUser, key: keyof NonNullable<SurveyResponses>): string {
    const sr = user.survey_responses;
    if (!sr) return '';
    const v = sr[key];
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join('; ');
    return String(v);
}

function formatCsvValue(user: SuperUser, key: string): string {
    if (key === 'is_pro') return user.is_pro ? 'Pro' : 'Free';
    if (key === 'created_at') return new Date(user.created_at).toISOString();
    if (key === 'longest_streak_days') {
        return String(user.longest_streak_days ?? user.streak_days);
    }
    if (key === 'notifications_enabled') {
        return user.notifications_enabled === null || user.notifications_enabled === undefined
            ? ''
            : (user.notifications_enabled ? 'on' : 'off');
    }
    if (key === 'reading_hours') return surveyValue(user, 'reading_hours');
    if (key === 'reason') return surveyValue(user, 'reason');
    if (key === 'referral_source') return surveyValue(user, 'referral_source');
    if (key === 'seen_count') {
        return user.seen_count === null || user.seen_count === undefined ? '' : String(user.seen_count);
    }
    const v = (user as unknown as Record<string, unknown>)[key];
    return v === null || v === undefined ? '' : String(v);
}

export default function SuperUsersPage() {
    const [users, setUsers] = useState<SuperUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Mode: all users, or only those with any UNSUBSCRIBE cancellation event.
    const [mode, setMode] = useState<Mode>('all');
    const [cancelledIds, setCancelledIds] = useState<string[] | null>(null);
    const [cancelledLoading, setCancelledLoading] = useState(false);
    const [cancelledProfiles, setCancelledProfiles] = useState<SuperUser[] | null>(null);

    // Cached result of top_super_users_by_seen(SEEN_RPC_MAX_ROWS).
    const [seenSorted, setSeenSorted] = useState<SuperUser[] | null>(null);
    const [seenLoading, setSeenLoading] = useState(false);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('streak_days');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    // Filters
    const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

    // Column visibility
    const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
        () => new Set(COLUMN_DEFS.filter(c => c.defaultVisible).map(c => c.key)),
    );
    const [showColumnPicker, setShowColumnPicker] = useState(false);

    // Pagination
    const [page, setPage] = useState(0);
    const pageSize = 50;
    const [hasMore, setHasMore] = useState(true);

    // Fetch distinct user IDs that have ever cancelled. Cached until page reload.
    useEffect(() => {
        if (mode !== 'cancelled' || cancelledIds !== null) return;
        let cancelled = false;
        (async () => {
            setCancelledLoading(true);
            try {
                const ids = new Set<string>();
                let pageIdx = 0;
                const size = 1000;
                while (true) {
                    const from = pageIdx * size;
                    const to = from + size - 1;
                    const { data, error: qErr } = await supabase
                        .from('subscription_events')
                        .select('user_id')
                        .eq('event_type', 'CANCELLATION')
                        .eq('cancel_reason', 'UNSUBSCRIBE')
                        .range(from, to);
                    if (qErr) throw new Error(qErr.message);
                    if (!data || data.length === 0) break;
                    for (const row of data as { user_id: string | null }[]) {
                        if (row.user_id) ids.add(row.user_id);
                    }
                    if (data.length < size) break;
                    pageIdx++;
                    if (ids.size > 100000) break;
                }
                if (!cancelled) setCancelledIds(Array.from(ids));
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load cancelled users');
            } finally {
                if (!cancelled) setCancelledLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [mode, cancelledIds]);

    // Load all cancelled profiles once (chunked to avoid URL length blowup).
    useEffect(() => {
        if (mode !== 'cancelled' || cancelledIds === null || cancelledProfiles !== null) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                if (cancelledIds.length === 0) {
                    if (!cancelled) setCancelledProfiles([]);
                    return;
                }
                const chunkSize = 150;
                const chunks: string[][] = [];
                for (let i = 0; i < cancelledIds.length; i += chunkSize) {
                    chunks.push(cancelledIds.slice(i, i + chunkSize));
                }
                const results = await Promise.all(
                    chunks.map((chunk) =>
                        supabase
                            .from('profiles')
                            .select(PROFILE_SELECT)
                            .eq('is_beta', false)
                            .in('id', chunk),
                    ),
                );
                const merged: SuperUser[] = [];
                for (const r of results) {
                    if (r.error) throw new Error(r.error.message);
                    if (r.data) merged.push(...(r.data as unknown as SuperUser[]));
                }
                if (!cancelled) setCancelledProfiles(merged);
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load cancelled profiles');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [mode, cancelledIds, cancelledProfiles]);

    // Kick off the seen-count RPC on demand. The RPC returns a single jsonb
    // array (rather than SETOF ROW) to bypass PostgREST's db-max-rows cap of
    // 1000 on this project, so we parse the array here.
    useEffect(() => {
        if (sortField !== 'seen_count') return;
        if (seenSorted !== null) return;
        let cancelled = false;
        (async () => {
            setSeenLoading(true);
            setError(null);
            try {
                const { data, error: rpcErr } = await supabase.rpc('top_super_users_by_seen', {
                    max_rows: SEEN_RPC_MAX_ROWS,
                });
                if (rpcErr) throw new Error(rpcErr.message);
                const raw: (SuperUser & { seen_count: number | string | null })[] = Array.isArray(data)
                    ? (data as (SuperUser & { seen_count: number | string | null })[])
                    : [];
                const rows: SuperUser[] = raw.map(r => ({
                    ...r,
                    seen_count: typeof r.seen_count === 'string' ? parseInt(r.seen_count, 10) : r.seen_count ?? 0,
                }));
                if (!cancelled) setSeenSorted(rows);
            } catch (err: unknown) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load seen counts');
            } finally {
                if (!cancelled) setSeenLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [sortField, seenSorted]);

    // Once cache is warm, backfill seen_count on rows served by other sorts.
    const enrichWithSeen = useCallback((rows: SuperUser[]): SuperUser[] => {
        if (!seenSorted) return rows;
        const counts = new Map<string, number>();
        for (const r of seenSorted) {
            if (r.id != null) counts.set(r.id, r.seen_count ?? 0);
        }
        return rows.map(r => ({ ...r, seen_count: counts.get(r.id) ?? r.seen_count ?? null }));
    }, [seenSorted]);

    // Apply the filter object as .eq/.ilike/.gte chains on a Supabase query.
    // Kept as a local helper so both fetchUsers and fetchAllForExport share it.
    type QueryLike = {
        eq: (col: string, val: unknown) => QueryLike;
        ilike: (col: string, val: string) => QueryLike;
        gte: (col: string, val: unknown) => QueryLike;
        filter: (col: string, op: string, val: unknown) => QueryLike;
    };
    const applyServerFilters = useCallback(<Q extends QueryLike>(q: Q): Q => {
        let out: QueryLike = q;
        if (filters.hskLevel) out = out.eq('hsk_level', parseInt(filters.hskLevel, 10));
        if (filters.pro === 'pro') out = out.eq('is_pro', true);
        else if (filters.pro === 'free') out = out.eq('is_pro', false);
        if (filters.notifications === 'on') out = out.eq('notifications_enabled', true);
        else if (filters.notifications === 'off') out = out.eq('notifications_enabled', false);
        if (filters.platform) out = out.eq('platform', filters.platform);
        if (filters.surveyReason) out = out.eq('survey_responses->>reason', filters.surveyReason);
        if (filters.surveyReadingHours) out = out.eq('survey_responses->>reading_hours', filters.surveyReadingHours);
        if (filters.timezoneContains) out = out.ilike('timezone', `%${filters.timezoneContains}%`);
        if (filters.minStreak) {
            const n = parseInt(filters.minStreak, 10);
            if (!Number.isNaN(n)) out = out.gte('streak_days', n);
        }
        return out as Q;
    }, [filters]);

    // Same filter set applied to already-fetched rows (cancelled / seen modes).
    const passesClientFilters = useCallback((u: SuperUser): boolean => {
        if (filters.hskLevel && String(u.hsk_level ?? '') !== filters.hskLevel) return false;
        if (filters.pro === 'pro' && !u.is_pro) return false;
        if (filters.pro === 'free' && u.is_pro) return false;
        if (filters.notifications === 'on' && !u.notifications_enabled) return false;
        if (filters.notifications === 'off' && u.notifications_enabled) return false;
        if (filters.platform && u.platform !== filters.platform) return false;
        if (filters.surveyReason && (u.survey_responses?.reason ?? '') !== filters.surveyReason) return false;
        if (filters.surveyReadingHours && (u.survey_responses?.reading_hours ?? '') !== filters.surveyReadingHours) return false;
        if (filters.timezoneContains && !(u.timezone ?? '').toLowerCase().includes(filters.timezoneContains.toLowerCase())) return false;
        if (filters.minStreak) {
            const n = parseInt(filters.minStreak, 10);
            if (!Number.isNaN(n) && u.streak_days < n) return false;
        }
        return true;
    }, [filters]);

    const fetchUsers = useCallback(async () => {
        // seen_count sort is served from the cached RPC result.
        if (sortField === 'seen_count') {
            if (seenSorted === null) return;
            let source: SuperUser[] = seenSorted;
            if (mode === 'cancelled') {
                if (cancelledIds === null) return;
                const idSet = new Set(cancelledIds);
                source = source.filter(u => idSet.has(u.id));
            }
            source = source.filter(passesClientFilters);
            const sorted = [...source].sort((a, b) => {
                const va = a.seen_count ?? 0;
                const vb = b.seen_count ?? 0;
                return sortOrder === 'asc' ? va - vb : vb - va;
            });
            const from = page * pageSize;
            setUsers(sorted.slice(from, from + pageSize));
            setHasMore(sorted.length > from + pageSize);
            setLoading(false);
            return;
        }

        if (mode === 'cancelled') {
            if (cancelledProfiles === null) return;
            const filtered = cancelledProfiles.filter(passesClientFilters);
            const sorted = [...filtered].sort((a, b) => {
                const dir = sortOrder === 'asc' ? 1 : -1;
                const va = a[sortField as Exclude<SortField, 'seen_count'>];
                const vb = b[sortField as Exclude<SortField, 'seen_count'>];
                if (va === vb) return 0;
                if (va === null || va === undefined) return 1;
                if (vb === null || vb === undefined) return -1;
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
                return String(va).localeCompare(String(vb)) * dir;
            });
            const from = page * pageSize;
            const slice = sorted.slice(from, from + pageSize);
            setUsers(enrichWithSeen(slice));
            setHasMore(sorted.length > from + pageSize);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const from = page * pageSize;
            const to = from + pageSize - 1;
            const base = supabase
                .from('profiles')
                .select(PROFILE_SELECT)
                .eq('is_beta', false)
                .order(sortField as Exclude<SortField, 'seen_count'>, { ascending: sortOrder === 'asc', nullsFirst: false })
                .range(from, to);
            const { data, error: queryError } = await applyServerFilters(base as unknown as QueryLike) as unknown as { data: SuperUser[] | null; error: { message: string } | null };
            if (queryError) throw new Error(queryError.message);
            setUsers(enrichWithSeen((data ?? []) as SuperUser[]));
            setHasMore((data?.length || 0) === pageSize);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [sortField, sortOrder, page, mode, cancelledProfiles, cancelledIds, seenSorted, enrichWithSeen, passesClientFilters, applyServerFilters]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Reset pagination whenever filters/sort/mode change.
    useEffect(() => {
        setPage(0);
    }, [filters, sortField, sortOrder, mode]);

    const [copied, setCopied] = useState(false);

    // CSV export
    const [showExportModal, setShowExportModal] = useState(false);
    const [selectedExportColumns, setSelectedExportColumns] = useState<Set<string>>(
        () => new Set(EXPORT_COLUMNS.map(c => c.key)),
    );
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportCount, setExportCount] = useState<number | null>(null);
    const [countLoading, setCountLoading] = useState(false);
    const [exportLimit, setExportLimit] = useState<number | null>(null);
    const [exportOffset, setExportOffset] = useState<number>(0);

    // Resolve export row count when the modal opens.
    useEffect(() => {
        if (!showExportModal) return;
        if (sortField === 'seen_count') {
            const filtered = (seenSorted ?? []).filter(passesClientFilters);
            const n = filtered.length;
            setExportCount(n);
            setExportLimit(prev => prev ?? Math.min(pageSize, n, EXPORT_HARD_CAP));
            return;
        }
        if (mode === 'cancelled') {
            const filtered = (cancelledProfiles ?? []).filter(passesClientFilters);
            const n = filtered.length;
            setExportCount(n);
            setExportLimit(prev => prev ?? Math.min(pageSize, n, EXPORT_HARD_CAP));
            return;
        }
        let cancelled = false;
        setCountLoading(true);
        (async () => {
            const base = supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .eq('is_beta', false);
            const { count, error: qErr } = await applyServerFilters(base as unknown as QueryLike) as unknown as { count: number | null; error: { message: string } | null };
            if (cancelled) return;
            if (qErr) setExportError(qErr.message);
            else {
                const n = count ?? 0;
                setExportCount(n);
                setExportLimit(prev => prev ?? Math.min(pageSize, n, EXPORT_HARD_CAP));
            }
            setCountLoading(false);
        })();
        return () => { cancelled = true; };
    }, [showExportModal, mode, cancelledProfiles, sortField, seenSorted, passesClientFilters, applyServerFilters]);

    const toggleExportColumn = (key: string) => {
        setSelectedExportColumns(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const sortUsersInMemory = useCallback((rows: SuperUser[]): SuperUser[] => {
        const dir = sortOrder === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const va = a[sortField as keyof SuperUser];
            const vb = b[sortField as keyof SuperUser];
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
    }, [sortField, sortOrder]);

    const fetchAllForExport = useCallback(async (limit: number | null, offset: number): Promise<SuperUser[]> => {
        const effectiveLimit = Math.min(limit ?? EXPORT_HARD_CAP, EXPORT_HARD_CAP);
        const effectiveOffset = Math.max(offset, 0);

        if (sortField === 'seen_count') {
            if (seenSorted === null) throw new Error('Seen-count data still loading');
            let source = seenSorted;
            if (mode === 'cancelled') {
                if (cancelledIds === null) throw new Error('Cancelled subscribers still loading');
                const idSet = new Set(cancelledIds);
                source = seenSorted.filter(u => idSet.has(u.id));
            }
            source = source.filter(passesClientFilters);
            const sorted = [...source].sort((a, b) => {
                const va = a.seen_count ?? 0;
                const vb = b.seen_count ?? 0;
                return sortOrder === 'asc' ? va - vb : vb - va;
            });
            return sorted.slice(effectiveOffset, effectiveOffset + effectiveLimit);
        }

        if (mode === 'cancelled') {
            if (cancelledProfiles === null) throw new Error('Cancelled subscribers still loading');
            const filtered = cancelledProfiles.filter(passesClientFilters);
            const sorted = sortUsersInMemory(filtered);
            const slice = sorted.slice(effectiveOffset, effectiveOffset + effectiveLimit);
            return enrichWithSeen(slice);
        }

        const batchSize = 1000;
        const collected: SuperUser[] = [];
        let batchIdx = 0;
        while (true) {
            const from = effectiveOffset + batchIdx * batchSize;
            const remaining = effectiveLimit - collected.length;
            if (remaining <= 0) break;
            const take = Math.min(batchSize, remaining);
            const to = from + take - 1;
            const base = supabase
                .from('profiles')
                .select(PROFILE_SELECT)
                .eq('is_beta', false)
                .order(sortField as Exclude<SortField, 'seen_count'>, { ascending: sortOrder === 'asc', nullsFirst: false })
                .range(from, to);
            const { data, error: qErr } = await applyServerFilters(base as unknown as QueryLike) as unknown as { data: SuperUser[] | null; error: { message: string } | null };
            if (qErr) throw new Error(qErr.message);
            if (!data || data.length === 0) break;
            collected.push(...(data as SuperUser[]));
            if (data.length < take) break;
            batchIdx++;
        }
        return enrichWithSeen(collected);
    }, [mode, cancelledProfiles, cancelledIds, sortField, sortOrder, sortUsersInMemory, seenSorted, enrichWithSeen, passesClientFilters, applyServerFilters]);

    const downloadCsv = async () => {
        if (selectedExportColumns.size === 0) {
            setExportError('Select at least one column');
            return;
        }
        setExporting(true);
        setExportError(null);
        try {
            const rows = await fetchAllForExport(exportLimit, exportOffset);
            const orderedCols = EXPORT_COLUMNS.filter(c => selectedExportColumns.has(c.key));
            const header = orderedCols.map(c => csvEscape(c.label)).join(',');
            const body = rows
                .map(r => orderedCols.map(c => csvEscape(formatCsvValue(r, c.key))).join(','))
                .join('\n');
            const csv = `${header}\n${body}\n`;
            const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            a.href = url;
            const offsetTag = exportOffset > 0 ? `-from${exportOffset}` : '';
            a.download = `super-users-${mode}-${sortField}-${sortOrder}${offsetTag}-${stamp}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setShowExportModal(false);
        } catch (err: unknown) {
            setExportError(err instanceof Error ? err.message : 'Failed to export CSV');
        } finally {
            setExporting(false);
        }
    };

    const copyEmails = () => {
        const emails = users
            .map(u => u.email)
            .filter((e): e is string => !!e)
            .join(', ');
        navigator.clipboard.writeText(emails);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const switchMode = (next: Mode) => {
        if (next === mode) return;
        setMode(next);
        setUsers([]);
    };

    const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const activeFilterCount = useMemo(() => {
        let n = 0;
        if (filters.hskLevel) n++;
        if (filters.pro !== 'all') n++;
        if (filters.notifications !== 'all') n++;
        if (filters.platform) n++;
        if (filters.surveyReason) n++;
        if (filters.surveyReadingHours) n++;
        if (filters.timezoneContains) n++;
        if (filters.minStreak) n++;
        return n;
    }, [filters]);

    const isBusy = loading
        || (mode === 'cancelled' && cancelledLoading && cancelledIds === null)
        || (mode === 'cancelled' && cancelledIds !== null && cancelledProfiles === null)
        || (sortField === 'seen_count' && seenLoading);

    const toggleColumn = (key: ColumnKey) => {
        setVisibleColumns(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const visibleColumnList = useMemo(
        () => COLUMN_DEFS.filter(c => visibleColumns.has(c.key)),
        [visibleColumns],
    );

    return (
        <div>
            <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Super Users</h1>
                    <p className="text-gray-600 mt-1 text-sm">
                        {mode === 'cancelled'
                            ? 'Users who have cancelled at some point, ranked so you can reach out to high-activity churn.'
                            : 'Users ranked by activity — filter, sort, and export.'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                        <button
                            onClick={() => switchMode('all')}
                            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${mode === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            All Users
                        </button>
                        <button
                            onClick={() => switchMode('cancelled')}
                            className={`px-3 py-1.5 text-sm font-medium rounded transition-colors ${mode === 'cancelled' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Cancelled Subscribers
                            {mode === 'cancelled' && cancelledIds !== null && (
                                <span className="ml-1.5 text-xs text-indigo-500 font-normal">({cancelledIds.length})</span>
                            )}
                        </button>
                    </div>
                    <button
                        onClick={copyEmails}
                        className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        {copied ? '✓ Copied!' : 'Copy Emails'}
                    </button>
                    <button
                        onClick={() => { setExportError(null); setShowExportModal(true); }}
                        disabled={mode === 'cancelled' && cancelledProfiles === null}
                        className="px-4 py-2 text-sm font-medium rounded-md border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Toolbar: sort + filters + column picker */}
            <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4 space-y-3">
                {/* Sort */}
                <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sort by</label>
                    <select
                        value={sortField}
                        onChange={e => setSortField(e.target.value as SortField)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                        {SORT_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    <div className="bg-white p-0.5 rounded-md border border-gray-200 flex">
                        <button
                            onClick={() => setSortOrder('desc')}
                            className={`px-2 py-1 text-xs font-medium rounded ${sortOrder === 'desc' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}
                        >
                            High → Low
                        </button>
                        <button
                            onClick={() => setSortOrder('asc')}
                            className={`px-2 py-1 text-xs font-medium rounded ${sortOrder === 'asc' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500'}`}
                        >
                            Low → High
                        </button>
                    </div>

                    <div className="flex-1" />

                    <div className="relative">
                        <button
                            onClick={() => setShowColumnPicker(v => !v)}
                            className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50"
                        >
                            Columns ({visibleColumns.size})
                        </button>
                        {showColumnPicker && (
                            <div className="absolute right-0 mt-1 z-20 bg-white rounded-md shadow-lg border border-gray-200 p-2 min-w-[200px]">
                                {COLUMN_DEFS.map(col => (
                                    <label key={col.key} className="flex items-center gap-2 text-sm text-gray-700 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={visibleColumns.has(col.key)}
                                            onChange={() => toggleColumn(col.key)}
                                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        {col.label}
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="h-px bg-gray-100" />

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Filters</label>

                    <select
                        value={filters.hskLevel}
                        onChange={e => setFilter('hskLevel', e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                    >
                        <option value="">HSK: any</option>
                        {HSK_LEVELS.map(l => <option key={l} value={l}>HSK {l}</option>)}
                    </select>

                    <select
                        value={filters.pro}
                        onChange={e => setFilter('pro', e.target.value as Filters['pro'])}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                    >
                        <option value="all">Any status</option>
                        <option value="pro">Pro only</option>
                        <option value="free">Free only</option>
                    </select>

                    <select
                        value={filters.notifications}
                        onChange={e => setFilter('notifications', e.target.value as Filters['notifications'])}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                    >
                        <option value="all">Notifications: any</option>
                        <option value="on">Notifications: on</option>
                        <option value="off">Notifications: off</option>
                    </select>

                    <select
                        value={filters.platform}
                        onChange={e => setFilter('platform', e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                    >
                        <option value="">Platform: any</option>
                        {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>

                    <select
                        value={filters.surveyReason}
                        onChange={e => setFilter('surveyReason', e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                    >
                        <option value="">Reason: any</option>
                        {REASON_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>

                    <select
                        value={filters.surveyReadingHours}
                        onChange={e => setFilter('surveyReadingHours', e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                    >
                        <option value="">Reading hours: any</option>
                        {READING_HOURS_OPTIONS.map(rh => <option key={rh} value={rh}>{rh}</option>)}
                    </select>

                    <input
                        type="text"
                        value={filters.timezoneContains}
                        onChange={e => setFilter('timezoneContains', e.target.value)}
                        placeholder="Timezone contains…"
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white w-40"
                    />

                    <div className="flex items-center gap-1">
                        <label className="text-xs text-gray-500">Min streak</label>
                        <input
                            type="number"
                            min={0}
                            value={filters.minStreak}
                            onChange={e => setFilter('minStreak', e.target.value)}
                            className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
                        />
                    </div>

                    {activeFilterCount > 0 && (
                        <button
                            onClick={() => setFilters(DEFAULT_FILTERS)}
                            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-800 underline"
                        >
                            Clear ({activeFilterCount})
                        </button>
                    )}
                </div>
            </div>

            {showExportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !exporting && setShowExportModal(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold text-gray-900">Export CSV</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            {mode === 'cancelled' ? 'Cancelled subscribers' : 'Super users'} matching filter:{' '}
                            <span className="font-medium">
                                {countLoading || exportCount === null ? '…' : exportCount.toLocaleString()}
                            </span>
                            . Sorted by <span className="font-medium">{sortField}</span> ({sortOrder}).
                        </p>
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Rows to export</label>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                <input
                                    type="number"
                                    min={1}
                                    max={Math.min(exportCount ?? EXPORT_HARD_CAP, EXPORT_HARD_CAP)}
                                    value={exportLimit ?? ''}
                                    onChange={e => {
                                        const raw = e.target.value;
                                        if (raw === '') { setExportLimit(null); return; }
                                        const n = parseInt(raw, 10);
                                        if (Number.isNaN(n) || n < 1) return;
                                        const ceiling = Math.min(exportCount ?? EXPORT_HARD_CAP, EXPORT_HARD_CAP);
                                        setExportLimit(Math.min(n, ceiling));
                                    }}
                                    className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:ring-1 focus:outline-none"
                                />
                                {exportCount !== null && (() => {
                                    const remaining = Math.max(exportCount - exportOffset, 0);
                                    const maxAllowed = Math.min(remaining, EXPORT_HARD_CAP);
                                    return (
                                        <button
                                            type="button"
                                            onClick={() => setExportLimit(maxAllowed)}
                                            className="text-xs text-indigo-600 hover:text-indigo-800"
                                        >
                                            Max ({maxAllowed.toLocaleString()})
                                        </button>
                                    );
                                })()}
                                {[50, 500, 5000, 50000].map(n => (
                                    (exportCount === null || n < exportCount) && n <= EXPORT_HARD_CAP ? (
                                        <button
                                            key={n}
                                            type="button"
                                            onClick={() => setExportLimit(n)}
                                            className="text-xs text-gray-500 hover:text-gray-700"
                                        >
                                            {n.toLocaleString()}
                                        </button>
                                    ) : null
                                ))}
                            </div>
                            {exportCount !== null && exportCount > EXPORT_HARD_CAP && (
                                <p className="mt-1 text-xs text-gray-500">
                                    Capped at {EXPORT_HARD_CAP.toLocaleString()} rows per export — use Start row below to page through more.
                                </p>
                            )}
                        </div>

                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700">Start at row</label>
                            <div className="mt-1 flex items-center gap-2 flex-wrap">
                                <input
                                    type="number"
                                    min={0}
                                    max={Math.max((exportCount ?? 0) - 1, 0)}
                                    value={exportOffset}
                                    onChange={e => {
                                        const raw = e.target.value;
                                        if (raw === '') { setExportOffset(0); return; }
                                        const n = parseInt(raw, 10);
                                        if (Number.isNaN(n) || n < 0) return;
                                        const ceiling = Math.max((exportCount ?? 0) - 1, 0);
                                        setExportOffset(Math.min(n, ceiling));
                                    }}
                                    className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-indigo-500 focus:ring-1 focus:outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => setExportOffset(0)}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                    Reset
                                </button>
                                {exportCount !== null && exportLimit !== null && exportOffset + exportLimit < exportCount && (
                                    <button
                                        type="button"
                                        onClick={() => setExportOffset(exportOffset + exportLimit)}
                                        className="text-xs text-indigo-600 hover:text-indigo-800"
                                    >
                                        Next page ({(exportOffset + exportLimit).toLocaleString()})
                                    </button>
                                )}
                            </div>
                            <p className="mt-1 text-xs text-gray-500">
                                0-indexed offset into the sorted list. Rows exported: {exportOffset.toLocaleString()} to {(exportOffset + (exportLimit ?? 0)).toLocaleString()}.
                            </p>
                        </div>

                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Columns</label>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            {EXPORT_COLUMNS.map(col => (
                                <label key={col.key} className="flex items-center gap-2 text-sm text-gray-700 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedExportColumns.has(col.key)}
                                        onChange={() => toggleExportColumn(col.key)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    {col.label}
                                </label>
                            ))}
                        </div>
                        <div className="mt-2 flex gap-3 text-xs">
                            <button
                                onClick={() => setSelectedExportColumns(new Set(EXPORT_COLUMNS.map(c => c.key)))}
                                className="text-indigo-600 hover:text-indigo-800"
                            >
                                Select all
                            </button>
                            <button
                                onClick={() => setSelectedExportColumns(new Set())}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                Clear
                            </button>
                        </div>
                        {exportError && (
                            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                {exportError}
                            </div>
                        )}
                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                onClick={() => setShowExportModal(false)}
                                disabled={exporting}
                                className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={downloadCsv}
                                disabled={exporting || selectedExportColumns.size === 0 || exportLimit === null || exportLimit < 1}
                                className="px-4 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {exporting
                                    ? 'Exporting…'
                                    : exportLimit !== null
                                        ? `Download ${exportLimit.toLocaleString()} rows`
                                        : 'Download'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                    {error}
                </div>
            )}

            {isBusy ? (
                <div className="p-6 text-gray-500">Loading super users...</div>
            ) : (
                <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                                {visibleColumnList.map(col => (
                                    <th key={col.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        {col.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {users.map((user, index) => {
                                const longest = user.longest_streak_days ?? user.streak_days;
                                return (
                                    <tr key={user.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400 font-mono">
                                            {page * pageSize + index + 1}
                                        </td>
                                        {visibleColumnList.map(col => (
                                            <td key={col.key} className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                                                {(() => {
                                                    switch (col.key) {
                                                        case 'name':
                                                            return <span className="font-medium text-gray-900">{user.full_name || '—'}</span>;
                                                        case 'email':
                                                            return <span className="text-gray-500">{user.email || '—'}</span>;
                                                        case 'streak_days':
                                                            return (
                                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${user.streak_days >= 100 ? 'bg-yellow-100 text-yellow-800' : user.streak_days >= 30 ? 'bg-green-100 text-green-800' : user.streak_days >= 7 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                                                                    {user.streak_days >= 100 && '🔥 '}
                                                                    {user.streak_days}
                                                                </span>
                                                            );
                                                        case 'longest_streak_days':
                                                            return (
                                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${longest >= 100 ? 'bg-yellow-100 text-yellow-800' : longest >= 30 ? 'bg-green-100 text-green-800' : longest >= 7 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                                                                    {longest >= 100 && '🏆 '}
                                                                    {longest}
                                                                </span>
                                                            );
                                                        case 'seen_count':
                                                            return <span className="font-mono">{user.seen_count === null || user.seen_count === undefined ? '—' : user.seen_count.toLocaleString()}</span>;
                                                        case 'hsk_level':
                                                            return <span className="font-mono">{user.hsk_level ?? '—'}</span>;
                                                        case 'daily_goal':
                                                            return <span className="font-mono">{user.daily_goal ?? '—'}</span>;
                                                        case 'notifications':
                                                            return user.notifications_enabled === null || user.notifications_enabled === undefined ? '—' : (
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.notifications_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                                                    {user.notifications_enabled ? 'on' : 'off'}
                                                                </span>
                                                            );
                                                        case 'timezone':
                                                            return <span className="text-gray-500">{user.timezone || '—'}</span>;
                                                        case 'reading_hours':
                                                            return <span className="text-gray-500">{user.survey_responses?.reading_hours || '—'}</span>;
                                                        case 'reason':
                                                            return <span className="text-gray-500">{user.survey_responses?.reason || '—'}</span>;
                                                        case 'platform':
                                                            return <span className="text-gray-500">{user.platform || '—'}</span>;
                                                        case 'is_pro':
                                                            return (
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${user.is_pro ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-600'}`}>
                                                                    {user.is_pro ? 'Pro' : 'Free'}
                                                                </span>
                                                            );
                                                        case 'created_at':
                                                            return <span className="text-gray-500">{new Date(user.created_at).toLocaleDateString()}</span>;
                                                        default:
                                                            return null;
                                                    }
                                                })()}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={visibleColumnList.length + 1} className="px-6 py-4 text-center text-sm text-gray-500">
                                        {mode === 'cancelled' ? 'No cancelled subscribers found.' : 'No users found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                    Showing {users.length === 0 ? 0 : page * pageSize + 1}–{page * pageSize + users.length} users
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Previous
                    </button>
                    <button
                        onClick={() => setPage(p => p + 1)}
                        disabled={!hasMore}
                        className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
}

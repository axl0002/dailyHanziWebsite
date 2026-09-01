"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

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
};

type SortField = 'streak_days' | 'longest_streak_days' | 'full_name' | 'created_at';
type SortOrder = 'asc' | 'desc';
type Mode = 'all' | 'cancelled';

type ExportColumn = {
    key: keyof SuperUser;
    label: string;
};

const EXPORT_COLUMNS: ExportColumn[] = [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'streak_days', label: 'Streak Days' },
    { key: 'longest_streak_days', label: 'Longest Streak' },
    { key: 'is_pro', label: 'Status (Pro/Free)' },
    { key: 'platform', label: 'Platform' },
    { key: 'timezone', label: 'Timezone' },
    { key: 'created_at', label: 'Joined' },
    { key: 'id', label: 'User ID' },
];

const EXPORT_HARD_CAP = 10000;

function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function formatCsvValue(user: SuperUser, key: keyof SuperUser): string {
    const v = user[key];
    if (key === 'is_pro') return v ? 'Pro' : 'Free';
    if (key === 'created_at' && typeof v === 'string') {
        return new Date(v).toISOString();
    }
    if (key === 'longest_streak_days' && (v === null || v === undefined)) {
        return String(user.streak_days);
    }
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
    // In cancelled mode we fetch matching profiles in chunks (to keep the
    // .in('id', […]) URL under proxy limits), cache the full set, then sort
    // and paginate client-side.
    const [cancelledProfiles, setCancelledProfiles] = useState<SuperUser[] | null>(null);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('streak_days');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

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
                    if (ids.size > 100000) break; // safety
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

    // Load all cancelled profiles once (chunked to avoid URL length blowup),
    // then sort + paginate in memory as sort/page changes.
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
                            .select('id, full_name, email, streak_days, longest_streak_days, is_pro, platform, timezone, created_at')
                            .eq('is_beta', false)
                            .in('id', chunk),
                    ),
                );
                const merged: SuperUser[] = [];
                for (const r of results) {
                    if (r.error) throw new Error(r.error.message);
                    if (r.data) merged.push(...(r.data as SuperUser[]));
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

    const fetchUsers = useCallback(async () => {
        if (mode === 'cancelled') {
            // Wait until the cached list has arrived.
            if (cancelledProfiles === null) return;
            const sorted = [...cancelledProfiles].sort((a, b) => {
                const dir = sortOrder === 'asc' ? 1 : -1;
                const va = a[sortField];
                const vb = b[sortField];
                if (va === vb) return 0;
                if (va === null || va === undefined) return 1;
                if (vb === null || vb === undefined) return -1;
                if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
                return String(va).localeCompare(String(vb)) * dir;
            });
            const from = page * pageSize;
            const slice = sorted.slice(from, from + pageSize);
            setUsers(slice);
            setHasMore(sorted.length > from + pageSize);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const from = page * pageSize;
            const to = from + pageSize - 1;

            const { data, error: queryError } = await supabase
                .from('profiles')
                .select('id, full_name, email, streak_days, longest_streak_days, is_pro, platform, timezone, created_at')
                .eq('is_beta', false)
                .order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
                .range(from, to);

            if (queryError) throw new Error(queryError.message);

            setUsers(data || []);
            setHasMore((data?.length || 0) === pageSize);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [sortField, sortOrder, page, mode, cancelledProfiles]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder(field === 'full_name' ? 'asc' : 'desc');
        }
        setPage(0);
    };

    const switchMode = (next: Mode) => {
        if (next === mode) return;
        setMode(next);
        setPage(0);
        setUsers([]);
    };

    const sortIndicator = (field: SortField) => {
        if (sortField !== field) return '';
        return sortOrder === 'asc' ? ' ↑' : ' ↓';
    };

    const [copied, setCopied] = useState(false);

    // CSV export modal
    const [showExportModal, setShowExportModal] = useState(false);
    const [selectedColumns, setSelectedColumns] = useState<Set<keyof SuperUser>>(
        () => new Set(EXPORT_COLUMNS.map(c => c.key)),
    );
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportCount, setExportCount] = useState<number | null>(null);
    const [countLoading, setCountLoading] = useState(false);
    const [exportLimit, setExportLimit] = useState<number | null>(null);

    // When the export modal opens, resolve how many rows will be exported.
    useEffect(() => {
        if (!showExportModal) return;
        if (mode === 'cancelled') {
            const n = cancelledProfiles?.length ?? null;
            setExportCount(n);
            setExportLimit(prev => prev ?? (n === null ? null : Math.min(pageSize, n, EXPORT_HARD_CAP)));
            return;
        }
        let cancelled = false;
        setCountLoading(true);
        (async () => {
            const { count, error: qErr } = await supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .eq('is_beta', false);
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
    }, [showExportModal, mode, cancelledProfiles]);

    const toggleColumn = (key: keyof SuperUser) => {
        setSelectedColumns(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const sortUsers = useCallback((rows: SuperUser[]): SuperUser[] => {
        const dir = sortOrder === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const va = a[sortField];
            const vb = b[sortField];
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
    }, [sortField, sortOrder]);

    const fetchAllForExport = useCallback(async (limit: number | null): Promise<SuperUser[]> => {
        const effectiveLimit = Math.min(limit ?? EXPORT_HARD_CAP, EXPORT_HARD_CAP);
        if (mode === 'cancelled') {
            if (cancelledProfiles === null) throw new Error('Cancelled subscribers still loading');
            const sorted = sortUsers(cancelledProfiles);
            return sorted.slice(0, effectiveLimit);
        }
        const batchSize = 1000;
        const collected: SuperUser[] = [];
        let batchIdx = 0;
        while (true) {
            const from = batchIdx * batchSize;
            const remaining = effectiveLimit - collected.length;
            if (remaining <= 0) break;
            const take = Math.min(batchSize, remaining);
            const to = from + take - 1;
            const { data, error: qErr } = await supabase
                .from('profiles')
                .select('id, full_name, email, streak_days, longest_streak_days, is_pro, platform, timezone, created_at')
                .eq('is_beta', false)
                .order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
                .range(from, to);
            if (qErr) throw new Error(qErr.message);
            if (!data || data.length === 0) break;
            collected.push(...(data as SuperUser[]));
            if (data.length < take) break;
            batchIdx++;
        }
        return collected;
    }, [mode, cancelledProfiles, sortField, sortOrder, sortUsers]);

    const downloadCsv = async () => {
        if (selectedColumns.size === 0) {
            setExportError('Select at least one column');
            return;
        }
        setExporting(true);
        setExportError(null);
        try {
            const rows = await fetchAllForExport(exportLimit);
            const orderedCols = EXPORT_COLUMNS.filter(c => selectedColumns.has(c.key));
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
            a.download = `super-users-${mode}-${sortField}-${sortOrder}-${stamp}.csv`;
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

    const isBusy = loading
        || (mode === 'cancelled' && cancelledLoading && cancelledIds === null)
        || (mode === 'cancelled' && cancelledIds !== null && cancelledProfiles === null);

    return (
        <div>
            <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Super Users</h1>
                    <p className="text-gray-600 mt-1">
                        {mode === 'cancelled'
                            ? 'Users who have cancelled at some point, ranked so you can reach out to high-activity churn.'
                            : 'Users ranked by highest streak days.'}
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

            {showExportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !exporting && setShowExportModal(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
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
                            <div className="mt-1 flex items-center gap-2">
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
                                    const maxAllowed = Math.min(exportCount, EXPORT_HARD_CAP);
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
                                {[50, 500, 5000].map(n => (
                                    (exportCount === null || n < exportCount) && n < EXPORT_HARD_CAP ? (
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
                                    Capped at {EXPORT_HARD_CAP.toLocaleString()} rows per export — narrow the filter or resort to page through more.
                                </p>
                            )}
                        </div>
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Columns</label>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            {EXPORT_COLUMNS.map(col => (
                                <label key={col.key} className="flex items-center gap-2 text-sm text-gray-700 py-1 px-2 rounded hover:bg-gray-50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedColumns.has(col.key)}
                                        onChange={() => toggleColumn(col.key)}
                                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    {col.label}
                                </label>
                            ))}
                        </div>
                        <div className="mt-2 flex gap-3 text-xs">
                            <button
                                onClick={() => setSelectedColumns(new Set(EXPORT_COLUMNS.map(c => c.key)))}
                                className="text-indigo-600 hover:text-indigo-800"
                            >
                                Select all
                            </button>
                            <button
                                onClick={() => setSelectedColumns(new Set())}
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
                                disabled={exporting || selectedColumns.size === 0 || exportLimit === null || exportLimit < 1}
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
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                                <th
                                    onClick={() => handleSort('full_name')}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                >
                                    Name{sortIndicator('full_name')}
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th
                                    onClick={() => handleSort('streak_days')}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                >
                                    Streak Days{sortIndicator('streak_days')}
                                </th>
                                <th
                                    onClick={() => handleSort('longest_streak_days')}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                >
                                    Longest Streak{sortIndicator('longest_streak_days')}
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Platform</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timezone</th>
                                <th
                                    onClick={() => handleSort('created_at')}
                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                >
                                    Joined{sortIndicator('created_at')}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {users.map((user, index) => {
                                const longest = user.longest_streak_days ?? user.streak_days;
                                return (
                                    <tr key={user.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">
                                            {page * pageSize + index + 1}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {user.full_name || "—"}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {user.email || "—"}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${user.streak_days >= 100
                                                ? 'bg-yellow-100 text-yellow-800'
                                                : user.streak_days >= 30
                                                    ? 'bg-green-100 text-green-800'
                                                    : user.streak_days >= 7
                                                        ? 'bg-blue-100 text-blue-800'
                                                        : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                {user.streak_days >= 100 && '🔥 '}
                                                {user.streak_days}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${longest >= 100
                                                ? 'bg-yellow-100 text-yellow-800'
                                                : longest >= 30
                                                    ? 'bg-green-100 text-green-800'
                                                    : longest >= 7
                                                        ? 'bg-blue-100 text-blue-800'
                                                        : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                {longest >= 100 && '🏆 '}
                                                {longest}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_pro
                                                ? 'bg-indigo-100 text-indigo-800'
                                                : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                {user.is_pro ? 'Pro' : 'Free'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {user.platform || "—"}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {user.timezone || "—"}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {new Date(user.created_at).toLocaleDateString()}
                                        </td>
                                    </tr>
                                );
                            })}
                            {users.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-6 py-4 text-center text-sm text-gray-500">
                                        {mode === 'cancelled' ? 'No cancelled subscribers found.' : 'No users found.'}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination */}
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

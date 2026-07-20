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

export default function SuperUsersPage() {
    const [users, setUsers] = useState<SuperUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Mode: all users, or only those with any UNSUBSCRIBE cancellation event.
    const [mode, setMode] = useState<Mode>('all');
    const [cancelledIds, setCancelledIds] = useState<string[] | null>(null);
    const [cancelledLoading, setCancelledLoading] = useState(false);

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

    const fetchUsers = useCallback(async () => {
        // In cancelled mode, wait for the ID list to load first.
        if (mode === 'cancelled' && cancelledIds === null) return;

        setLoading(true);
        setError(null);
        try {
            const from = page * pageSize;
            const to = from + pageSize - 1;

            let query = supabase
                .from("profiles")
                .select("id, full_name, email, streak_days, longest_streak_days, is_pro, platform, timezone, created_at")
                .eq('is_beta', false);

            if (mode === 'cancelled') {
                const ids = cancelledIds ?? [];
                if (ids.length === 0) {
                    setUsers([]);
                    setHasMore(false);
                    setLoading(false);
                    return;
                }
                query = query.in('id', ids);
            }

            const { data, error: queryError } = await query
                .order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
                .range(from, to);

            if (queryError) throw new Error(queryError.message);

            setUsers(data || []);
            setHasMore((data?.length || 0) === pageSize);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [sortField, sortOrder, page, mode, cancelledIds]);

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

    const copyEmails = () => {
        const emails = users
            .map(u => u.email)
            .filter((e): e is string => !!e)
            .join(', ');
        navigator.clipboard.writeText(emails);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const isBusy = loading || (mode === 'cancelled' && cancelledLoading && cancelledIds === null);

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
                </div>
            </div>

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

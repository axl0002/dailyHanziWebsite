"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Feedback = {
    id: string;
    created_at: string;
    user_id: string | null;
    liked: boolean | null;
    improvement: string | null;
    missing: string | null;
};

type SortField = "created_at" | "liked" | "user";
type SortOrder = "asc" | "desc";
type LikedFilter = "all" | "liked" | "disliked" | "unrated";

type FeedbackUser = {
    email: string | null;
    timezone: string | null;
};

export default function FeedbackPage() {
    const [rows, setRows] = useState<Feedback[]>([]);
    const [usersById, setUsersById] = useState<Record<string, FeedbackUser>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [sortField, setSortField] = useState<SortField>("created_at");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [likedFilter, setLikedFilter] = useState<LikedFilter>("all");

    const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
        user: true,
        liked: true,
        improvement: true,
        missing: true,
        created_at: true,
    });

    const fetchFeedback = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let query = supabase.from("feedback").select("*");

            if (likedFilter === "liked") query = query.eq("liked", true);
            else if (likedFilter === "disliked") query = query.eq("liked", false);
            else if (likedFilter === "unrated") query = query.is("liked", null);

            const dbSortField = sortField === "user" ? "user_id" : sortField;
            query = query.order(dbSortField, { ascending: sortOrder === "asc" });

            const { data, error: queryError } = await query;
            if (queryError) throw queryError;

            const loaded = (data || []) as Feedback[];
            setRows(loaded);

            const userIds = Array.from(
                new Set(loaded.map((r) => r.user_id).filter((id): id is string => !!id))
            );

            if (userIds.length > 0) {
                const { data: profiles, error: profileErr } = await supabase
                    .from("profiles")
                    .select("id, email, timezone")
                    .in("id", userIds);
                if (profileErr) throw profileErr;

                const map: Record<string, FeedbackUser> = {};
                for (const p of profiles || []) {
                    map[p.id] = { email: p.email ?? null, timezone: p.timezone ?? null };
                }
                setUsersById(map);
            } else {
                setUsersById({});
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, [sortField, sortOrder, likedFilter]);

    useEffect(() => {
        fetchFeedback();
    }, [fetchFeedback]);

    const stats = useMemo(() => {
        const total = rows.length;
        const liked = rows.filter((r) => r.liked === true).length;
        const disliked = rows.filter((r) => r.liked === false).length;
        const unrated = rows.filter((r) => r.liked === null).length;
        const withImprovement = rows.filter((r) => r.improvement && r.improvement.trim().length > 0).length;
        const withMissing = rows.filter((r) => r.missing && r.missing.trim().length > 0).length;
        const rated = liked + disliked;
        const likedPct = rated > 0 ? Math.round((liked / rated) * 100) : null;
        return { total, liked, disliked, unrated, withImprovement, withMissing, likedPct };
    }, [rows]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortOrder("desc");
        }
    };

    const toggleColumn = (key: string) => {
        setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const sortArrow = (field: SortField) =>
        sortField === field ? (sortOrder === "asc" ? "↑" : "↓") : "";

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Feedback</h1>
                <p className="text-gray-600 mt-1">User feedback from Daily Hanzi, including likes, improvement suggestions, and requested missing features.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                <StatCard label="Total" value={stats.total} />
                <StatCard label="Liked" value={stats.liked} tone="green" />
                <StatCard label="Disliked" value={stats.disliked} tone="red" />
                <StatCard label="Unrated" value={stats.unrated} />
                <StatCard label="With Improvement" value={stats.withImprovement} tone="indigo" />
                <StatCard label="With Missing" value={stats.withMissing} tone="indigo" />
            </div>

            {stats.likedPct !== null && (
                <div className="mb-6 text-sm text-gray-600">
                    <span className="font-medium text-gray-800">{stats.likedPct}%</span> positive across {stats.liked + stats.disliked} rated responses.
                </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <div className="bg-white p-1 rounded-lg border border-gray-200 flex shadow-sm">
                    {(["all", "liked", "disliked", "unrated"] as LikedFilter[]).map((f) => (
                        <button
                            key={f}
                            onClick={() => setLikedFilter(f)}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors capitalize ${likedFilter === f
                                ? "bg-indigo-50 text-indigo-700"
                                : "text-gray-600 hover:text-gray-900"
                                }`}
                        >
                            {f}
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap gap-2 items-center justify-end">
                    <span className="text-xs text-gray-500 mr-1 font-semibold uppercase tracking-wide">Columns:</span>
                    {Object.keys(visibleColumns).map((key) => (
                        <button
                            key={key}
                            onClick={() => toggleColumn(key)}
                            className={`px-3 py-1 text-xs font-medium rounded-full border transition-all capitalize ${visibleColumns[key]
                                ? "bg-black text-white border-black shadow-sm"
                                : "bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600"
                                }`}
                        >
                            {key.replace("_", " ")}
                        </button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="p-6 text-gray-500">Loading feedback...</div>
            ) : error ? (
                <div className="p-6 text-red-500">Error: {error}</div>
            ) : (
                <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                {visibleColumns.user && (
                                    <th
                                        onClick={() => handleSort("user")}
                                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    >
                                        User {sortArrow("user")}
                                    </th>
                                )}
                                {visibleColumns.liked && (
                                    <th
                                        onClick={() => handleSort("liked")}
                                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    >
                                        Liked {sortArrow("liked")}
                                    </th>
                                )}
                                {visibleColumns.improvement && (
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Improvement
                                    </th>
                                )}
                                {visibleColumns.missing && (
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Missing
                                    </th>
                                )}
                                {visibleColumns.created_at && (
                                    <th
                                        onClick={() => handleSort("created_at")}
                                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                    >
                                        Created At {sortArrow("created_at")}
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {rows.map((row) => (
                                <tr key={row.id}>
                                    {visibleColumns.user && (
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {row.user_id ? (
                                                <div className="flex flex-col">
                                                    <span className="text-gray-800">
                                                        {usersById[row.user_id]?.email || "Unknown email"}
                                                    </span>
                                                    <span className="text-xs text-gray-500">
                                                        {usersById[row.user_id]?.timezone || "No timezone"}
                                                    </span>
                                                    <span className="text-xs text-gray-400 font-mono mt-1">
                                                        ID: {row.user_id}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-gray-400">N/A</span>
                                            )}
                                        </td>
                                    )}
                                    {visibleColumns.liked && (
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <LikedBadge value={row.liked} />
                                        </td>
                                    )}
                                    {visibleColumns.improvement && (
                                        <td className="px-6 py-4 text-sm text-gray-700 max-w-[420px] whitespace-pre-wrap break-words align-top">
                                            {row.improvement || <span className="text-gray-300"></span>}
                                        </td>
                                    )}
                                    {visibleColumns.missing && (
                                        <td className="px-6 py-4 text-sm text-gray-700 max-w-[420px] whitespace-pre-wrap break-words align-top">
                                            {row.missing || <span className="text-gray-300"></span>}
                                        </td>
                                    )}
                                    {visibleColumns.created_at && (
                                        <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 align-top">
                                            {new Date(row.created_at).toLocaleString()}
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                                        No feedback found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: "green" | "red" | "indigo" }) {
    const toneClasses =
        tone === "green"
            ? "bg-green-50 border-green-200 text-green-800"
            : tone === "red"
                ? "bg-red-50 border-red-200 text-red-800"
                : tone === "indigo"
                    ? "bg-indigo-50 border-indigo-200 text-indigo-800"
                    : "bg-white border-gray-200 text-gray-800";
    return (
        <div className={`rounded-lg border shadow-sm p-4 ${toneClasses}`}>
            <div className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</div>
            <div className="text-2xl font-bold mt-1">{value}</div>
        </div>
    );
}

function LikedBadge({ value }: { value: boolean | null }) {
    if (value === true) {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                Liked
            </span>
        );
    }
    if (value === false) {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                Disliked
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
            Unrated
        </span>
    );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Feedback = {
    id: string;
    created_at: string;
    user_id: string | null;
    liked: string | null;
    improvement: string | null;
    missing: string | null;
};

type SortField = "created_at" | "user";
type SortOrder = "asc" | "desc";

type FeedbackUser = {
    email: string | null;
    timezone: string | null;
    platform: string | null;
    app_version: string | null;
};

export default function FeedbackPage() {
    const [rows, setRows] = useState<Feedback[]>([]);
    const [usersById, setUsersById] = useState<Record<string, FeedbackUser>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [sortField, setSortField] = useState<SortField>("created_at");
    const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
    const [search, setSearch] = useState("");

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
            const dbSortField = sortField === "user" ? "user_id" : sortField;
            const { data, error: queryError } = await supabase
                .from("feedback")
                .select("*")
                .order(dbSortField, { ascending: sortOrder === "asc" });
            if (queryError) throw queryError;

            const loaded = (data || []) as Feedback[];
            setRows(loaded);

            const userIds = Array.from(
                new Set(loaded.map((r) => r.user_id).filter((id): id is string => !!id))
            );

            if (userIds.length > 0) {
                const { data: profiles, error: profileErr } = await supabase
                    .from("profiles")
                    .select("id, email, timezone, platform, app_version")
                    .in("id", userIds);
                if (profileErr) throw profileErr;

                const map: Record<string, FeedbackUser> = {};
                for (const p of profiles || []) {
                    map[p.id] = {
                        email: p.email ?? null,
                        timezone: p.timezone ?? null,
                        platform: p.platform ?? null,
                        app_version: p.app_version ?? null,
                    };
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
    }, [sortField, sortOrder]);

    useEffect(() => {
        fetchFeedback();
    }, [fetchFeedback]);

    const filteredRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => {
            const email = r.user_id ? usersById[r.user_id]?.email ?? "" : "";
            return (
                (r.liked ?? "").toLowerCase().includes(q) ||
                (r.improvement ?? "").toLowerCase().includes(q) ||
                (r.missing ?? "").toLowerCase().includes(q) ||
                email.toLowerCase().includes(q)
            );
        });
    }, [rows, usersById, search]);

    const stats = useMemo(() => {
        const nonEmpty = (s: string | null) => !!s && s.trim().length > 0;
        const total = filteredRows.length;
        const withLiked = filteredRows.filter((r) => nonEmpty(r.liked)).length;
        const withImprovement = filteredRows.filter((r) => nonEmpty(r.improvement)).length;
        const withMissing = filteredRows.filter((r) => nonEmpty(r.missing)).length;
        return { total, withLiked, withImprovement, withMissing };
    }, [filteredRows]);

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
                <p className="text-gray-600 mt-1">User feedback from Daily Hanzi: what they liked, improvement suggestions, and requested missing features.</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <StatCard label="Total" value={stats.total} />
                <StatCard label="With Liked" value={stats.withLiked} tone="green" />
                <StatCard label="With Improvement" value={stats.withImprovement} tone="indigo" />
                <StatCard label="With Missing" value={stats.withMissing} tone="indigo" />
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <div className="relative">
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search text or email..."
                        className="pl-3 pr-8 py-2 text-sm border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 w-64"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                            title="Clear"
                        >
                            ✕
                        </button>
                    )}
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
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Liked
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
                            {filteredRows.map((row) => (
                                <tr key={row.id}>
                                    {visibleColumns.user && (
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {row.user_id ? (
                                                <div className="flex flex-col">
                                                    <span className="text-gray-800">
                                                        {usersById[row.user_id]?.email || "Unknown email"}
                                                    </span>
                                                    <span className="text-xs text-gray-500">
                                                        {usersById[row.user_id]?.platform || "No platform"}
                                                        {usersById[row.user_id]?.app_version ? ` v${usersById[row.user_id]?.app_version}` : ""}
                                                        {" · "}
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
                                        <td className="px-6 py-4 text-sm text-gray-700 max-w-[420px] whitespace-pre-wrap break-words align-top">
                                            {row.liked || <span className="text-gray-300"></span>}
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
                            {filteredRows.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                                        {search ? `No feedback matching "${search}".` : "No feedback found."}
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

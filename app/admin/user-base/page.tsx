"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type UserRow = {
    id: string;
    full_name: string | null;
    email: string | null;
    is_beta: boolean;
    is_pro: boolean;
    created_at: string;
};

export default function UserBasePage() {
    const [query, setQuery] = useState("");
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [deleting, setDeleting] = useState(false);

    const runSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        setLoading(true);
        setError(null);
        setHasSearched(true);
        try {
            const { data, error: qerr } = await supabase
                .from("profiles")
                .select("id, full_name, email, is_beta, is_pro, created_at")
                .ilike("email", `%${query.trim()}%`)
                .order("created_at", { ascending: false })
                .limit(25);
            if (qerr) throw new Error(qerr.message);
            setUsers(data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    const toggleBeta = async (user: UserRow) => {
        setSavingId(user.id);
        setError(null);
        const newValue = !user.is_beta;
        try {
            const { data, error: uerr } = await supabase
                .from("profiles")
                .update({ is_beta: newValue })
                .eq("id", user.id)
                .select("id");
            if (uerr) throw new Error(uerr.message);
            if (!data || data.length === 0) {
                throw new Error("Update did not affect any rows — likely blocked by RLS. Ask engineering to add an UPDATE policy on profiles for admins.");
            }
            setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, is_beta: newValue } : u));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setSavingId(null);
        }
    };

    const openDelete = (user: UserRow) => {
        setDeleteTarget(user);
        setDeleteConfirmText("");
        setError(null);
    };

    const cancelDelete = () => {
        if (deleting) return;
        setDeleteTarget(null);
        setDeleteConfirmText("");
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        setError(null);
        try {
            const res = await fetch("/api/admin/delete-user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: deleteTarget.id }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`);
            setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
            setDeleteTarget(null);
            setDeleteConfirmText("");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setDeleting(false);
        }
    };

    const canConfirmDelete = deleteTarget != null
        && deleteConfirmText.trim().toLowerCase() === (deleteTarget.email || "").trim().toLowerCase()
        && !deleting;

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">User Base</h1>
                <p className="text-gray-600 mt-1">Search users by email to manage beta access or delete accounts.</p>
            </div>

            <form onSubmit={runSearch} className="mb-6 flex gap-2">
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by email (partial match)"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-indigo-500 text-sm"
                />
                <button
                    type="submit"
                    disabled={loading || !query.trim()}
                    className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loading ? "Searching…" : "Search"}
                </button>
            </form>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                    {error}
                </div>
            )}

            <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Plan</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Beta</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {users.map((user) => (
                            <tr key={user.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {user.full_name || "—"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {user.email || "—"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_pro ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-600'}`}>
                                        {user.is_pro ? 'Pro' : 'Free'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_beta ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                        {user.is_beta ? 'Beta' : 'Not beta'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(user.created_at).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            onClick={() => toggleBeta(user)}
                                            disabled={savingId === user.id}
                                            className={`px-3 py-1 text-sm font-medium rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${user.is_beta
                                                ? 'border-red-200 text-red-700 hover:bg-red-50'
                                                : 'border-green-200 text-green-700 hover:bg-green-50'
                                                }`}
                                        >
                                            {savingId === user.id
                                                ? "Saving…"
                                                : user.is_beta ? "Revoke beta" : "Grant beta"}
                                        </button>
                                        <button
                                            onClick={() => openDelete(user)}
                                            className="px-3 py-1 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!loading && hasSearched && users.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                                    No matching users found.
                                </td>
                            </tr>
                        )}
                        {!hasSearched && (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                                    Enter an email above to search.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            {users.length === 25 && (
                <p className="mt-3 text-xs text-gray-500">Showing first 25 matches. Refine your search if the user isn&apos;t here.</p>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={cancelDelete}>
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-gray-900 mb-2">Delete user account</h2>
                        <p className="text-sm text-gray-600 mb-4">
                            This will permanently delete <strong>{deleteTarget.email || deleteTarget.id}</strong> and all their data. This cannot be undone.
                        </p>
                        <p className="text-sm text-gray-700 mb-2">
                            Type the user&apos;s email to confirm:
                        </p>
                        <input
                            type="text"
                            value={deleteConfirmText}
                            onChange={(e) => setDeleteConfirmText(e.target.value)}
                            placeholder={deleteTarget.email || ""}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:border-red-500 text-sm"
                            autoFocus
                            disabled={deleting}
                        />
                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                onClick={cancelDelete}
                                disabled={deleting}
                                className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmDelete}
                                disabled={!canConfirmDelete}
                                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {deleting ? "Deleting…" : "Delete permanently"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

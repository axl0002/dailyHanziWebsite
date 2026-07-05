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

export default function BetaAccessPage() {
    const [query, setQuery] = useState("");
    const [users, setUsers] = useState<UserRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [hasSearched, setHasSearched] = useState(false);

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
            // Supabase returns success with an empty array when RLS silently blocks the write.
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

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Beta Access</h1>
                <p className="text-gray-600 mt-1">Search users by email and grant or revoke beta access.</p>
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
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
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
        </div>
    );
}

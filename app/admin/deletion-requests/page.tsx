"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type DeletionRequestRow = {
    id: string;
    email: string | null;
    requested_at: string | null;
    notes: string | null;
    status: string | null;
    processed_at: string | null;
};

export default function DeletionRequestsPage() {
    const [rows, setRows] = useState<DeletionRequestRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DeletionRequestRow | null>(null);
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [deleting, setDeleting] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: qerr } = await supabase
                .from("deletion_requests")
                .select("id, email, requested_at, notes, status, processed_at")
                .is("processed_at", null)
                .order("requested_at", { ascending: false });
            if (qerr) throw new Error(qerr.message);
            setRows(data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const openDelete = (row: DeletionRequestRow) => {
        setDeleteTarget(row);
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
        const email = deleteTarget.email?.trim();
        if (!email) {
            setError("Request has no email — cannot look up account.");
            return;
        }
        setDeleting(true);
        setError(null);
        try {
            const { data: profile, error: perr } = await supabase
                .from("profiles")
                .select("id")
                .eq("email", email)
                .maybeSingle();
            if (perr) throw new Error(`Profile lookup failed: ${perr.message}`);

            if (profile?.id) {
                const res = await fetch("/api/admin/delete-user", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ userId: profile.id }),
                });
                const body = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`);
            }

            const { error: uerr } = await supabase
                .from("deletion_requests")
                .update({ processed_at: new Date().toISOString() })
                .eq("id", deleteTarget.id);
            if (uerr) throw new Error(`Account removed but marking request processed failed: ${uerr.message}`);

            setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
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
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Deletion Requests</h1>
                    <p className="text-gray-600 mt-1">Pending account deletion requests. Deleting removes the user account permanently.</p>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className="px-3 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                    {error}
                </div>
            )}

            <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requested</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {rows.map((row) => (
                            <tr key={row.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {row.email || "—"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {row.requested_at ? new Date(row.requested_at).toLocaleString() : "—"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                        {row.status || "pending"}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-sm text-gray-600 max-w-md">
                                    {row.notes || "—"}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    <button
                                        onClick={() => openDelete(row)}
                                        className="px-3 py-1 text-sm font-medium rounded-md border border-red-300 text-red-700 hover:bg-red-50 transition-colors"
                                    >
                                        Delete account
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {!loading && rows.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                                    No pending deletion requests.
                                </td>
                            </tr>
                        )}
                        {loading && rows.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">
                                    Loading…
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {deleteTarget && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={cancelDelete}>
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-lg font-bold text-gray-900 mb-2">Delete user account</h2>
                        <p className="text-sm text-gray-600 mb-4">
                            This will permanently delete <strong>{deleteTarget.email || deleteTarget.id}</strong> and all their data, and mark this request as processed. This cannot be undone.
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

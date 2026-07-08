"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import CreateDeckModal from "./CreateDeckModal";

type Category = {
    id: number;
    name: string;
    ordering: number | null;
    emoji: string | null;
    visible: boolean;
    abbreviation: string | null;
};

export default function DecksPage() {
    const router = useRouter();
    const [categories, setCategories] = useState<Category[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [showCreate, setShowCreate] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [cats, chars] = await Promise.all([
                supabase
                    .from("categories")
                    .select("id, name, ordering, emoji, visible, abbreviation")
                    .order("ordering", { ascending: true, nullsFirst: false })
                    .order("name", { ascending: true }),
                fetchAllCharacterCategories(),
            ]);
            if (cats.error) throw new Error(cats.error.message);
            setCategories(cats.data || []);
            const grouped: Record<string, number> = {};
            for (const c of chars) grouped[c] = (grouped[c] || 0) + 1;
            setCounts(grouped);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const toggleVisibility = async (cat: Category) => {
        setBusyId(cat.id);
        setError(null);
        try {
            const { data, error: uerr } = await supabase
                .from("categories")
                .update({ visible: !cat.visible })
                .eq("id", cat.id)
                .select("id");
            if (uerr) throw new Error(uerr.message);
            if (!data || data.length === 0) throw new Error("Update blocked by RLS.");
            setCategories((prev) => prev.map((c) => c.id === cat.id ? { ...c, visible: !cat.visible } : c));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setBusyId(null);
        }
    };

    const deleteDeck = async (cat: Category) => {
        const charCount = counts[cat.name] ?? 0;
        if (charCount > 0) {
            setError(`Cannot delete "${cat.name}" — it still has ${charCount} character${charCount === 1 ? '' : 's'}. Remove them first.`);
            return;
        }
        if (!confirm(`Delete deck "${cat.name}"? This cannot be undone.`)) return;
        setBusyId(cat.id);
        setError(null);
        try {
            const { data, error: derr } = await supabase
                .from("categories")
                .delete()
                .eq("id", cat.id)
                .select("id");
            if (derr) throw new Error(derr.message);
            if (!data || data.length === 0) throw new Error("Delete blocked by RLS.");
            setCategories((prev) => prev.filter((c) => c.id !== cat.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Decks</h1>
                    <p className="text-gray-600 mt-1">Browse character categories. Click a deck to see its characters.</p>
                </div>
                <button
                    onClick={() => setShowCreate(true)}
                    className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                    + New Deck
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100 text-center text-gray-500">
                    Loading decks…
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {categories.map((cat) => (
                        <div
                            key={cat.id}
                            onClick={() => router.push(`/admin/decks/${cat.id}`)}
                            className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition cursor-pointer"
                        >
                            <div className="flex items-start justify-between mb-2">
                                <span className="text-3xl" aria-hidden>{cat.emoji || "📁"}</span>
                                <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full font-mono">
                                    {counts[cat.name] ?? 0} chars
                                </span>
                            </div>
                            <div className="flex items-center gap-2 mb-1">
                                <h3 className="text-base font-bold text-gray-900">{cat.name}</h3>
                                {!cat.visible && (
                                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium">
                                        hidden
                                    </span>
                                )}
                            </div>
                            {cat.abbreviation && cat.abbreviation !== cat.name && (
                                <p className="text-xs text-gray-500 mb-3">{cat.abbreviation}</p>
                            )}
                            <div className="mt-3 flex gap-2 pt-3 border-t border-gray-100">
                                <button
                                    onClick={(e) => { e.stopPropagation(); toggleVisibility(cat); }}
                                    disabled={busyId === cat.id}
                                    className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors disabled:opacity-50 ${cat.visible
                                        ? 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                        : 'border-green-200 text-green-700 hover:bg-green-50'
                                        }`}
                                >
                                    {cat.visible ? 'Hide' : 'Make visible'}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); deleteDeck(cat); }}
                                    disabled={busyId === cat.id}
                                    className="ml-auto px-2.5 py-1 text-xs font-medium border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <CreateDeckModal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                onCreated={load}
            />
        </div>
    );
}

async function fetchAllCharacterCategories(): Promise<string[]> {
    const all: string[] = [];
    const pageSize = 1000;
    let page = 0;
    while (true) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await supabase
            .from("characters")
            .select("category")
            .range(from, to);
        if (error) throw new Error(error.message);
        const batch = (data || []).map((r) => r.category as string | null).filter((c): c is string => !!c);
        all.push(...batch);
        if (!data || data.length < pageSize) break;
        page++;
        if (all.length > 100000) break;
    }
    return all;
}

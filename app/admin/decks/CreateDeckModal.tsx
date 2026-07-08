"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type SearchResult = {
    id: number;
    character: string;
    pinyin: string | null;
    meaning: string | null;
    category: string | null;
};

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
};

export default function CreateDeckModal({ open, onClose, onCreated }: Props) {
    const [name, setName] = useState("");
    const [emoji, setEmoji] = useState("");
    const [abbreviation, setAbbreviation] = useState("");
    const [ordering, setOrdering] = useState<number>(100);
    const [charSearch, setCharSearch] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<Map<number, SearchResult>>(new Map());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setName("");
            setEmoji("");
            setAbbreviation("");
            setOrdering(100);
            setCharSearch("");
            setSearchResults([]);
            setSelected(new Map());
            setError(null);
        }
    }, [open]);

    const runSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!charSearch.trim()) return;
        setSearching(true);
        setError(null);
        try {
            const q = charSearch.trim();
            const { data, error: qerr } = await supabase
                .from("characters")
                .select("id, character, pinyin, meaning, category")
                .or(`character.ilike.%${q}%,pinyin.ilike.%${q}%,meaning.ilike.%${q}%`)
                .order("id", { ascending: true })
                .limit(50);
            if (qerr) throw new Error(qerr.message);
            setSearchResults(data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setSearching(false);
        }
    };

    const toggleChar = (c: SearchResult) => {
        setSelected((prev) => {
            const next = new Map(prev);
            if (next.has(c.id)) next.delete(c.id);
            else next.set(c.id, c);
            return next;
        });
    };

    const create = async () => {
        if (!name.trim()) {
            setError("Name is required.");
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            const { data: inserted, error: insErr } = await supabase
                .from("categories")
                .insert({
                    name: name.trim(),
                    emoji: emoji.trim() || null,
                    abbreviation: abbreviation.trim() || null,
                    ordering: Number.isFinite(ordering) ? ordering : null,
                    visible: false,
                })
                .select("id, name")
                .single();
            if (insErr) throw new Error(insErr.message);
            if (!inserted) throw new Error("Insert returned no row (likely blocked by RLS).");

            if (selected.size > 0) {
                const ids = Array.from(selected.keys());
                const { data: updated, error: uerr } = await supabase
                    .from("characters")
                    .update({ category: inserted.name })
                    .in("id", ids)
                    .select("id");
                if (uerr) throw new Error(uerr.message);
                if (!updated || updated.length === 0) {
                    throw new Error("Category created, but character assignment was blocked by RLS. Ask engineering to add an UPDATE policy on characters for admins.");
                }
            }
            onCreated();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setSubmitting(false);
        }
    };

    const selectedList = useMemo(() => Array.from(selected.values()), [selected]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-200">
                    <h2 className="text-lg font-bold text-gray-900">New deck</h2>
                    <p className="text-sm text-gray-500 mt-1">Created decks start as <strong>hidden</strong>. Toggle visibility when ready.</p>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">{error}</div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div className="sm:col-span-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Emoji</label>
                            <input
                                type="text"
                                value={emoji}
                                onChange={(e) => setEmoji(e.target.value)}
                                placeholder="📁"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Fun Foods"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                        </div>
                        <div className="sm:col-span-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Ordering</label>
                            <input
                                type="number"
                                value={ordering}
                                onChange={(e) => setOrdering(Number(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Abbreviation</label>
                            <input
                                type="text"
                                value={abbreviation}
                                onChange={(e) => setAbbreviation(e.target.value)}
                                placeholder="Food"
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                        </div>
                    </div>

                    <div className="border-t border-gray-200 pt-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Populate with characters (optional)</label>
                        <form onSubmit={runSearch} className="flex gap-2">
                            <input
                                type="text"
                                value={charSearch}
                                onChange={(e) => setCharSearch(e.target.value)}
                                placeholder="Search by character, pinyin, or meaning"
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                            />
                            <button
                                type="submit"
                                disabled={searching || !charSearch.trim()}
                                className="px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                            >
                                {searching ? "…" : "Search"}
                            </button>
                        </form>

                        {searchResults.length > 0 && (
                            <div className="mt-3 border border-gray-200 rounded-md max-h-56 overflow-y-auto">
                                {searchResults.map((r) => {
                                    const isSelected = selected.has(r.id);
                                    return (
                                        <button
                                            key={r.id}
                                            type="button"
                                            onClick={() => toggleChar(r)}
                                            className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b last:border-b-0 border-gray-100 hover:bg-gray-50 ${isSelected ? 'bg-indigo-50' : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                readOnly
                                                className="pointer-events-none"
                                            />
                                            <span className="text-lg font-medium text-gray-900 w-16">{r.character}</span>
                                            <span className="text-xs text-gray-500 italic w-32 truncate">{r.pinyin || "—"}</span>
                                            <span className="text-xs text-gray-700 flex-1 truncate">{r.meaning || "—"}</span>
                                            {r.category && (
                                                <span className="text-[10px] text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">
                                                    was: {r.category}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {selectedList.length > 0 && (
                            <div className="mt-3">
                                <p className="text-xs font-medium text-gray-500 mb-1">Selected ({selectedList.length})</p>
                                <div className="flex flex-wrap gap-1">
                                    {selectedList.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => toggleChar(c)}
                                            className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded text-sm hover:bg-indigo-200"
                                            title="Remove from selection"
                                        >
                                            {c.character} ×
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 flex justify-end gap-2 bg-gray-50">
                    <button
                        onClick={onClose}
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-medium border border-gray-300 text-gray-700 rounded-md hover:bg-white disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={create}
                        disabled={submitting || !name.trim()}
                        className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? "Creating…" : "Create deck"}
                    </button>
                </div>
            </div>
        </div>
    );
}

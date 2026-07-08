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
    onAdded: () => void;
    categoryName: string;
};

export default function AddCharactersModal({ open, onClose, onAdded, categoryName }: Props) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [selected, setSelected] = useState<Map<number, SearchResult>>(new Map());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setQuery("");
            setResults([]);
            setSelected(new Map());
            setError(null);
        }
    }, [open]);

    const runSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;
        setSearching(true);
        setError(null);
        try {
            const q = query.trim();
            const { data, error: qerr } = await supabase
                .from("characters")
                .select("id, character, pinyin, meaning, category")
                .or(`character.ilike.%${q}%,pinyin.ilike.%${q}%,meaning.ilike.%${q}%`)
                .order("id", { ascending: true })
                .limit(50);
            if (qerr) throw new Error(qerr.message);
            setResults(data || []);
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

    const submit = async () => {
        if (selected.size === 0) return;
        setSubmitting(true);
        setError(null);
        try {
            const ids = Array.from(selected.keys());
            const { data, error: uerr } = await supabase
                .from("characters")
                .update({ category: categoryName })
                .in("id", ids)
                .select("id");
            if (uerr) throw new Error(uerr.message);
            if (!data || data.length === 0) {
                throw new Error("No characters were updated — likely blocked by RLS.");
            }
            onAdded();
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
                    <h2 className="text-lg font-bold text-gray-900">Add characters to {categoryName}</h2>
                    <p className="text-sm text-gray-500 mt-1">Characters can only be in one deck at a time — adding here removes them from their current deck.</p>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">{error}</div>
                    )}

                    <form onSubmit={runSearch} className="flex gap-2">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search by character, pinyin, or meaning"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                        <button
                            type="submit"
                            disabled={searching || !query.trim()}
                            className="px-3 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                            {searching ? "…" : "Search"}
                        </button>
                    </form>

                    {results.length > 0 && (
                        <div className="border border-gray-200 rounded-md max-h-72 overflow-y-auto">
                            {results.map((r) => {
                                const isSelected = selected.has(r.id);
                                const alreadyHere = r.category === categoryName;
                                return (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={() => !alreadyHere && toggleChar(r)}
                                        disabled={alreadyHere}
                                        className={`w-full flex items-center gap-3 px-3 py-2 text-left border-b last:border-b-0 border-gray-100 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed ${isSelected ? 'bg-indigo-50' : ''}`}
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
                                        {alreadyHere ? (
                                            <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded">already in deck</span>
                                        ) : r.category ? (
                                            <span className="text-[10px] text-orange-700 bg-orange-100 px-1.5 py-0.5 rounded">was: {r.category}</span>
                                        ) : (
                                            <span className="text-[10px] text-gray-500">no deck</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {selectedList.length > 0 && (
                        <div>
                            <p className="text-xs font-medium text-gray-500 mb-1">Selected ({selectedList.length})</p>
                            <div className="flex flex-wrap gap-1">
                                {selectedList.map((c) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => toggleChar(c)}
                                        className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded text-sm hover:bg-indigo-200"
                                    >
                                        {c.character} ×
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
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
                        onClick={submit}
                        disabled={submitting || selected.size === 0}
                        className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? "Adding…" : `Add ${selected.size || ""} to deck`.trim()}
                    </button>
                </div>
            </div>
        </div>
    );
}

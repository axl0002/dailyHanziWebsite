"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import AddCharactersModal from "../AddCharactersModal";

type Category = {
    id: number;
    name: string;
    emoji: string | null;
    visible: boolean;
};

type Character = {
    id: number;
    character: string;
    traditional: string | null;
    pinyin: string | null;
    meaning: string | null;
    hsk_level: number | null;
    freq_rank: number | null;
    visible: boolean;
};

type SortField = 'id' | 'character' | 'hsk_level' | 'freq_rank';
type SortOrder = 'asc' | 'desc';

export default function DeckDetailPage() {
    const params = useParams<{ id: string }>();
    const categoryId = Number(params.id);
    const [category, setCategory] = useState<Category | null>(null);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sortField, setSortField] = useState<SortField>('freq_rank');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
    const [removingId, setRemovingId] = useState<number | null>(null);
    const [showAdd, setShowAdd] = useState(false);

    const load = useCallback(async () => {
        if (Number.isNaN(categoryId)) {
            setError("Invalid category id");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const { data: catData, error: catErr } = await supabase
                .from("categories")
                .select("id, name, emoji, visible")
                .eq("id", categoryId)
                .maybeSingle();
            if (catErr) throw new Error(catErr.message);
            if (!catData) throw new Error("Category not found");
            setCategory(catData);

            const { data: chars, error: charErr } = await supabase
                .from("characters")
                .select("id, character, traditional, pinyin, meaning, hsk_level, freq_rank, visible")
                .eq("category", catData.name)
                .order(sortField, { ascending: sortOrder === 'asc', nullsFirst: false })
                .limit(2000);
            if (charErr) throw new Error(charErr.message);
            setCharacters(chars || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, [categoryId, sortField, sortOrder]);

    useEffect(() => {
        load();
    }, [load]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    };

    const sortIndicator = (field: SortField) =>
        sortField === field ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';

    const removeCharacter = async (c: Character) => {
        if (!confirm(`Remove "${c.character}" from this deck?`)) return;
        setRemovingId(c.id);
        setError(null);
        try {
            const { data, error: uerr } = await supabase
                .from("characters")
                .update({ category: null })
                .eq("id", c.id)
                .select("id");
            if (uerr) throw new Error(uerr.message);
            if (!data || data.length === 0) throw new Error("Update blocked by RLS.");
            setCharacters((prev) => prev.filter((x) => x.id !== c.id));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setRemovingId(null);
        }
    };

    return (
        <div>
            <div className="mb-4">
                <Link href="/admin/decks" className="text-sm text-indigo-600 hover:text-indigo-800">
                    ← Back to decks
                </Link>
            </div>

            {category && (
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl" aria-hidden>{category.emoji || "📁"}</span>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                                {category.name}
                                {!category.visible && (
                                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">hidden</span>
                                )}
                            </h1>
                            <p className="text-gray-600 mt-1">{characters.length} character{characters.length === 1 ? "" : "s"}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowAdd(true)}
                        className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                    >
                        + Add characters
                    </button>
                </div>
            )}

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100 text-center text-gray-500">
                    Loading characters…
                </div>
            ) : (
                <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th onClick={() => handleSort('id')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    ID{sortIndicator('id')}
                                </th>
                                <th onClick={() => handleSort('character')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Character{sortIndicator('character')}
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Traditional</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pinyin</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Meaning</th>
                                <th onClick={() => handleSort('hsk_level')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    HSK{sortIndicator('hsk_level')}
                                </th>
                                <th onClick={() => handleSort('freq_rank')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Freq{sortIndicator('freq_rank')}
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visible</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {characters.map((c) => (
                                <tr key={c.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400 font-mono">{c.id}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-xl text-gray-900">{c.character}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-lg text-gray-500">{c.traditional || "—"}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 italic">{c.pinyin || "—"}</td>
                                    <td className="px-6 py-4 text-sm text-gray-700">{c.meaning || "—"}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{c.hsk_level ?? "—"}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{c.freq_rank ?? "—"}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.visible ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                                            {c.visible ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <button
                                            onClick={() => removeCharacter(c)}
                                            disabled={removingId === c.id}
                                            className="px-2.5 py-1 text-xs font-medium border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                                        >
                                            {removingId === c.id ? "Removing…" : "Remove"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {characters.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-500">
                                        No characters in this deck.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {category && (
                <AddCharactersModal
                    open={showAdd}
                    onClose={() => setShowAdd(false)}
                    onAdded={load}
                    categoryName={category.name}
                />
            )}
        </div>
    );
}

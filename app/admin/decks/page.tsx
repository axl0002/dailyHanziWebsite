"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Category = {
    id: number;
    name: string;
    ordering: number | null;
    emoji: string | null;
    visible: boolean;
    abbreviation: string | null;
};

export default function DecksPage() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const [cats, chars] = await Promise.all([
                    supabase
                        .from("categories")
                        .select("id, name, ordering, emoji, visible, abbreviation")
                        .order("ordering", { ascending: true, nullsFirst: false })
                        .order("name", { ascending: true }),
                    // Paginate categories column so we can compute per-category counts locally.
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
        };
        load();
    }, []);

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Decks</h1>
                <p className="text-gray-600 mt-1">Browse character categories. Click a deck to see its characters.</p>
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
                        <Link
                            key={cat.id}
                            href={`/admin/decks/${cat.id}`}
                            className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 hover:shadow-md hover:border-indigo-200 transition"
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
                                <p className="text-xs text-gray-500">{cat.abbreviation}</p>
                            )}
                        </Link>
                    ))}
                </div>
            )}
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

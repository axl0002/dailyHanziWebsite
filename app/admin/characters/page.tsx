"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import CharacterEditModal, { Character, ExampleSentence } from "../components/CharacterEditModal";

type CharacterRow = Character & {
    example_sentences?: ExampleSentence[];
};

type SortField = keyof Character | null;
type SortOrder = 'asc' | 'desc';

export default function CharactersPage() {
    const [characters, setCharacters] = useState<CharacterRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Search & Pagination
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(50);
    const [totalCount, setTotalCount] = useState(0);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('id');
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

    // Column Visibility
    const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
        id: true,
        character: true,
        pinyin: true,
        meaning: true,
        example_sentences: true,
        hsk_level: true,
        freq_rank: false, // Default hidden
        category: true,
        visible: true,
        actions: true
    });

    // Editing
    const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
    const [showModal, setShowModal] = useState(false);

    const fetchCharacters = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from("characters")
                .select("*, example_sentences(id, chinese, traditional, pinyin, english)", { count: 'exact' });

            if (searchTerm) {
                query = query.ilike('character', `%${searchTerm}%`);
            }

            if (sortField) {
                query = query.order(sortField, { ascending: sortOrder === 'asc' });
            }

            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;
            query = query.range(from, to);

            const { data, count, error } = await query;

            if (error) throw error;
            setCharacters(data || []);
            setTotalCount(count || 0);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, sortField, sortOrder, currentPage, itemsPerPage]);

    useEffect(() => {
        fetchCharacters();
    }, [fetchCharacters]);

    // ... (rest of the file)

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setCurrentPage(1); // Reset to first page on search
        fetchCharacters();
    };

    const handleSort = (field: keyof Character) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    };

    const toggleColumn = (key: string) => {
        setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleEditClick = (char: CharacterRow) => {
        setEditingCharacter(char);
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setEditingCharacter(null);
        setShowModal(false);
    };

    const handleSave = () => {
        fetchCharacters();
        handleCloseModal();
    };

    const handleDelete = async (char: Character) => {
        console.log("Attempting to delete character:", char.id, char.character);
        if (!window.confirm(`Are you sure you want to delete "${char.character}"? This action cannot be undone.`)) {
            console.log("Deletion cancelled by user.");
            return;
        }

        try {
            console.log("Deleting character from database...");
            const { error, data } = await supabase
                .from("characters")
                .delete()
                .eq("id", char.id)
                .select();

            if (error) {
                console.error("Error deleting character:", error);
                throw error;
            }

            if (!data || data.length === 0) {
                console.error("Delete operation returned 0 rows. RLS policy likely prevented deletion.");
                alert("Failed to delete character. You might not have permission (RLS Policy).");
                return;
            }

            console.log("Character deleted successfully:", data);

            // Optimistic update or refresh
            setCharacters(prev => prev.filter(c => c.id !== char.id));
            setTotalCount(prev => prev - 1);

        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            console.error("Delete operation failed:", err);
            alert("Error deleting character: " + message);
        }
    };

    const totalPages = Math.ceil(totalCount / itemsPerPage);

    return (
        <div>
            <h1 className="text-2xl font-bold mb-6">Characters Management</h1>

            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Error: </strong>
                    <span className="block sm:inline">{error}</span>
                </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                {/* Search Bar */}
                <form onSubmit={handleSearch} className="flex gap-2 w-full max-w-sm">
                    <input
                        type="text"
                        placeholder="Search..."
                        className="border p-2 rounded w-full"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <button type="submit" className="bg-black text-white px-4 py-2 rounded hover:bg-gray-800">
                        Search
                    </button>
                </form>

                {/* Column Toggles */}
                <div className="flex flex-wrap gap-2 items-center justify-end">
                    <span className="text-xs text-gray-500 mr-1 font-semibold uppercase tracking-wide">Columns:</span>
                    {Object.keys(visibleColumns).map(key => (
                        <button
                            key={key}
                            onClick={() => toggleColumn(key)}
                            className={`px-3 py-1 text-xs font-medium rounded-full border transition-all capitalize ${visibleColumns[key]
                                ? "bg-black text-white border-black shadow-sm"
                                : "bg-white text-gray-400 border-gray-200 hover:border-gray-300 hover:text-gray-600"
                                }`}
                        >
                            {key.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {visibleColumns.id && (
                                <th onClick={() => handleSort('id')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    ID {sortField === 'id' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.character && (
                                <th onClick={() => handleSort('character')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Char {sortField === 'character' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.pinyin && (
                                <th onClick={() => handleSort('pinyin')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Pinyin {sortField === 'pinyin' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.meaning && (
                                <th onClick={() => handleSort('meaning')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Meaning {sortField === 'meaning' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.example_sentences && (
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Example Sentences
                                </th>
                            )}
                            {visibleColumns.hsk_level && (
                                <th onClick={() => handleSort('hsk_level')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    HSK {sortField === 'hsk_level' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.freq_rank && (
                                <th onClick={() => handleSort('freq_rank')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Freq {sortField === 'freq_rank' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.category && (
                                <th onClick={() => handleSort('category')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Category {sortField === 'category' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.visible && (
                                <th onClick={() => handleSort('visible')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Visible {sortField === 'visible' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.actions && (
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan={10} className="px-6 py-4 text-center">Loading...</td></tr>
                        ) : characters.map((char) => (
                            <tr key={char.id}>
                                {visibleColumns.id && <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400 font-mono">{String(char.id).substring(0, 8)}</td>}
                                {visibleColumns.character && <td className="px-6 py-4 whitespace-nowrap text-lg font-bold">{char.character}</td>}
                                {visibleColumns.pinyin && <td className="px-6 py-4 whitespace-nowrap">{char.pinyin}</td>}
                                {visibleColumns.meaning && (
                                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[200px]" title={char.meaning}>
                                        {char.meaning}
                                    </td>
                                )}
                                {visibleColumns.example_sentences && (
                                    <td className="px-6 py-4 text-xs text-gray-500 max-w-[300px]">
                                        {Array.isArray(char.example_sentences) && char.example_sentences.length > 0 ? (
                                            <div className="space-y-2">
                                                {char.example_sentences.slice(0, 2).map((sentence, idx) => (
                                                    <div key={idx} className="border-b last:border-0 pb-1 last:pb-0 border-gray-100">
                                                        <div className="font-semibold text-gray-800">{sentence.chinese}</div>
                                                        {sentence.traditional && sentence.traditional !== sentence.chinese && (
                                                            <div className="text-gray-700">{sentence.traditional}</div>
                                                        )}
                                                        <div className="italic text-gray-600">{sentence.pinyin}</div>
                                                        <div className="text-gray-400">{sentence.english}</div>
                                                    </div>
                                                ))}
                                                {char.example_sentences.length > 2 && (
                                                    <div className="text-xs font-bold text-gray-400 pt-1">+{char.example_sentences.length - 2} more</div>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-gray-300">No examples</span>
                                        )}
                                    </td>
                                )}
                                {visibleColumns.hsk_level && <td className="px-6 py-4 whitespace-nowrap">{char.hsk_level}</td>}
                                {visibleColumns.freq_rank && <td className="px-6 py-4 whitespace-nowrap">{char.freq_rank}</td>}
                                {visibleColumns.category && <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{char.category}</td>}
                                {visibleColumns.visible && (
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${char.visible ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {char.visible ? 'Yes' : 'No'}
                                        </span>
                                    </td>
                                )}
                                {visibleColumns.actions && (
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <button
                                            onClick={() => handleEditClick(char)}
                                            className="text-indigo-600 hover:text-indigo-900 mr-4"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(char)}
                                            className="text-red-600 hover:text-red-900"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {!loading && characters.length === 0 && (
                            <tr><td colSpan={10} className="px-6 py-4 text-center">No characters found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 bg-white p-4 rounded-lg shadow-sm">
                <span className="text-sm text-gray-700">
                    Page <span className="font-medium">{currentPage}</span> of <span className="font-medium">{totalPages}</span>
                    <span className="ml-2 text-gray-500">({totalCount} total)</span>
                </span>
                <div className="flex gap-2">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 border rounded disabled:opacity-50 hover:bg-gray-50"
                    >
                        Previous
                    </button>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-4 py-2 border rounded disabled:opacity-50 hover:bg-gray-50"
                    >
                        Next
                    </button>
                </div>
            </div>

            {/* Edit Modal */}
            {showModal && editingCharacter && (
                <CharacterEditModal
                    character={editingCharacter}
                    onClose={handleCloseModal}
                    onSave={handleSave}
                />
            )}
        </div>
    );
}

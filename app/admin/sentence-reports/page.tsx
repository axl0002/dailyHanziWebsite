"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import CharacterEditModal, { Character } from "../components/CharacterEditModal";

type SentenceReport = {
    id: string;
    created_at: string;
    user_id: string;
    character_id: string;
    character_content: string;
    sentence_chinese: string;
    sentence_pinyin: string;
    sentence_english: string;
    issue_type: string;
    characters: {
        pinyin: string;
        meaning: string;
        category: string;
    } | null;
};

type SortField = keyof SentenceReport;
type SortOrder = 'asc' | 'desc';

export default function SentenceReportsPage() {
    const [reports, setReports] = useState<SentenceReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('created_at');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    // Column Visibility
    const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
        user_id: false,
        character: true,
        category: true,
        sentence: true,
        issue_type: true,
        created_at: false,
        actions: true,
    });

    // Editing
    const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
    const [showModal, setShowModal] = useState(false);

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from("sentence_reports")
                .select("*, characters(pinyin, meaning, category)");

            if (sortField) {
                query = query.order(sortField, { ascending: sortOrder === 'asc' });
            } else {
                query = query.order('created_at', { ascending: false });
            }

            const { data, error } = await query;

            if (error) throw error;

            setReports(data || []);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [sortField, sortOrder]);

    useEffect(() => {
        fetchReports();
    }, [fetchReports]);

    const handleSort = (field: SortField) => {
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

    const handleEditClick = async (characterId: string) => {
        try {
            const { data, error } = await supabase
                .from("characters")
                .select("*")
                .eq("id", characterId)
                .single();

            if (error) throw error;
            if (data) {
                setEditingCharacter(data);
                setShowModal(true);
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            alert("Error fetching character details: " + message);
        }
    };

    const handleDeleteCharacter = async (characterId: string, characterContent: string) => {
        if (!window.confirm(`Are you sure you want to delete the CHARACTER "${characterContent}"? \n\n⚠️ This will delete the character AND this report.\n⚠️ This action cannot be undone.`)) {
            return;
        }

        try {
            // Database is set to CASCADE delete related reports automatically
            const { error } = await supabase
                .from("characters")
                .delete()
                .eq("id", characterId);

            if (error) throw error;

            alert("Character and associated reports deleted successfully.");

            // Remove reports associated with this character from the view
            setReports(prev => prev.filter(r => r.character_id !== characterId));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            alert("Error deleting char: " + message);
        }
    };

    const handleDeleteReport = async (reportId: string) => {
        if (!window.confirm("Are you sure you want to delete ONLY this report? The character will remain unchanged.")) {
            return;
        }

        try {
            const { error } = await supabase
                .from("sentence_reports")
                .delete()
                .eq("id", reportId);

            if (error) throw error;

            alert("Report deleted successfully.");
            setReports(prev => prev.filter(r => r.id !== reportId));
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            alert("Error deleting report: " + message);
        }
    };

    const handleCloseModal = () => {
        setEditingCharacter(null);
        setShowModal(false);
    };

    const handleSave = () => {
        handleCloseModal();
        // Optionally refresh reports if character data is shown there?
        // The report stores static snapshots of some data usually, but here character_content might be dynamic if joined, 
        // but report schema has it as a field.
        // If we edited the character, the report might still show old data unless we refetch or unless report joins.
        // Given the report has `character_content` field, it's likely a snapshot or view.
        // For now, just close modal.
        fetchReports();
    };

    if (loading) return <div className="p-6">Loading reports...</div>;
    if (error) return <div className="p-6 text-red-500">Error: {error}</div>;

    return (
        <div>
            <h1 className="text-2xl font-bold mb-6">Sentence Reports</h1>

            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                {/* Column Toggles */}
                <div className="flex flex-wrap gap-2 items-center justify-end w-full">
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

            <div className="bg-white shadow-md rounded-lg overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {visibleColumns.user_id && (
                                <th onClick={() => handleSort('user_id')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    User ID {sortField === 'user_id' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.character && (
                                <th onClick={() => handleSort('character_content')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Character {sortField === 'character_content' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.category && (
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Category
                                </th>
                            )}
                            {visibleColumns.sentence && (
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Reported Sentence
                                </th>
                            )}
                            {visibleColumns.issue_type && (
                                <th onClick={() => handleSort('issue_type')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Issue Type {sortField === 'issue_type' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.created_at && (
                                <th onClick={() => handleSort('created_at')} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100">
                                    Created At {sortField === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                            )}
                            {visibleColumns.actions && (
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {reports.map((report) => (
                            <tr key={report.id}>
                                {visibleColumns.user_id && (
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 font-mono">
                                        {report.user_id || 'N/A'}
                                    </td>
                                )}
                                {visibleColumns.character && (
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex flex-col">
                                            <span className="text-lg font-bold text-gray-900">{report.character_content}</span>
                                            {report.characters && (
                                                <>
                                                    <span className="text-sm text-gray-600">{report.characters.pinyin}</span>
                                                    <span className="text-xs text-gray-500 max-w-[150px] truncate" title={report.characters.meaning}>
                                                        {report.characters.meaning}
                                                    </span>
                                                </>
                                            )}
                                            <span className="text-xs text-gray-400 font-mono mt-1">ID: {report.character_id}</span>
                                        </div>
                                    </td>
                                )}
                                {visibleColumns.category && (
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {report.characters?.category && (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                                                {report.characters.category}
                                            </span>
                                        )}
                                    </td>
                                )}
                                {visibleColumns.sentence && (
                                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[400px]">
                                        <div className="space-y-1">
                                            <div className="font-semibold text-gray-800">{report.sentence_chinese}</div>
                                            <div className="italic text-gray-600">{report.sentence_pinyin}</div>
                                            <div className="text-gray-500">{report.sentence_english}</div>
                                        </div>
                                    </td>
                                )}
                                {visibleColumns.issue_type && (
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-700">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${report.issue_type === 'error' ? 'bg-red-100 text-red-800' :
                                            report.issue_type === 'suggestion' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                                            }`}>
                                            {report.issue_type}
                                        </span>
                                    </td>
                                )}
                                {visibleColumns.created_at && (
                                    <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                                        {new Date(report.created_at).toLocaleString()}
                                    </td>
                                )}
                                {visibleColumns.actions && (
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        <div className="flex flex-col gap-2 items-end">
                                            <button
                                                onClick={() => handleEditClick(report.character_id)}
                                                className="text-indigo-600 hover:text-indigo-900"
                                            >
                                                Edit Character
                                            </button>
                                            <button
                                                onClick={() => handleDeleteReport(report.id)}
                                                className="text-gray-600 hover:text-gray-900"
                                            >
                                                Delete Report
                                            </button>
                                            <button
                                                onClick={() => handleDeleteCharacter(report.character_id, report.character_content)}
                                                className="text-red-600 hover:text-red-900 font-semibold"
                                            >
                                                Delete Char
                                            </button>
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {reports.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                                    No reports found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
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

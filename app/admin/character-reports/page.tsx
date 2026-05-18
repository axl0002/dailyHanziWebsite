"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import CharacterEditModal, { Character } from "../components/CharacterEditModal";

type CharacterReport = {
    id: string;
    created_at: string;
    user_id: string;
    character_id: string;
    character_content: string;
    pinyin: string;
    meaning: string;
    issue_type: string;
};

type SortField = keyof CharacterReport;
type SortOrder = 'asc' | 'desc';

export default function CharacterReportsPage() {
    const [reports, setReports] = useState<CharacterReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Sorting
    const [sortField, setSortField] = useState<SortField>('created_at');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    // Column Visibility
    const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
        user_id: false,
        character: true,
        details: true,
        issue_type: true,
        created_at: false,
        actions: true,
    });

    // Editing
    const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
    const [showModal, setShowModal] = useState(false);

    // Audio playback
    const [playingReportId, setPlayingReportId] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handlePlayAudio = (reportId: string, characterId: string) => {
        if (!characterId) return;

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        if (playingReportId === reportId) {
            setPlayingReportId(null);
            return;
        }

        const audioUrl = `https://pub-20c697fbe15d4d9aa3faae12deaea269.r2.dev/character/char_${characterId}.mp3`;
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        setPlayingReportId(reportId);
        audio.addEventListener("ended", () => setPlayingReportId(null));
        audio.addEventListener("error", () => setPlayingReportId(null));
        audio.play().catch(() => setPlayingReportId(null));
    };

    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    const fetchReports = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from("character_reports")
                .select("*");

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
                .from("character_reports")
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
        fetchReports();
    };

    if (loading) return <div className="p-6">Loading reports...</div>;
    if (error) return <div className="p-6 text-red-500">Error: {error}</div>;

    return (
        <div>
            <h1 className="text-2xl font-bold mb-6">Character Reports</h1>

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
                            {visibleColumns.details && (
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Details (Pinyin / Meaning)
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
                                            <div className="flex items-center gap-2">
                                                <span className="text-lg font-bold text-gray-900">{report.character_content}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handlePlayAudio(report.id, report.character_id)}
                                                    disabled={!report.character_id}
                                                    title="Play audio"
                                                    className="shrink-0 px-1.5 py-1 rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                                >
                                                    {playingReportId === report.id ? (
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-gray-700">
                                                            <path d="M5.5 3.5A1.5 1.5 0 017 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5zM13 3.5A1.5 1.5 0 0114.5 5v10a1.5 1.5 0 01-3 0V5A1.5 1.5 0 0113 3.5z" />
                                                        </svg>
                                                    ) : (
                                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-gray-700">
                                                            <path d="M6.3 2.84A1 1 0 004.8 3.7v12.6a1 1 0 001.5.86l11-6.3a1 1 0 000-1.72l-11-6.3z" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                            <span className="text-xs text-gray-400 font-mono">ID: {report.character_id}</span>
                                        </div>
                                    </td>
                                )}
                                {visibleColumns.details && (
                                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[400px]">
                                        <div className="space-y-1">
                                            <div className="italic text-gray-800">{report.pinyin}</div>
                                            <div className="text-gray-600">{report.meaning}</div>
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

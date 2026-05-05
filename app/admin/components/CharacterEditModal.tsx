"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type ExampleSentence = {
    id?: number;
    pinyin: string;
    chinese: string;
    traditional: string;
    english: string;
    audio_url?: string | null;
};

export type Character = {
    id: string;
    character: string;
    pinyin: string;
    meaning: string;
    freq_rank: number;
    hsk_level: number;
    category: string;
    visible: boolean;
};

interface CharacterEditModalProps {
    character: Character;
    onClose: () => void;
    onSave: () => void;
}

export default function CharacterEditModal({ character, onClose, onSave }: CharacterEditModalProps) {
    const [editingCharacter, setEditingCharacter] = useState<Character>(character);
    const [sentences, setSentences] = useState<ExampleSentence[]>([]);
    const [originalSentences, setOriginalSentences] = useState<Map<number, ExampleSentence>>(new Map());
    const [sentencesLoading, setSentencesLoading] = useState(true);
    const [categories, setCategories] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [playingSentenceId, setPlayingSentenceId] = useState<number | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handlePlayAudio = (sentence: ExampleSentence) => {
        if (!sentence.audio_url || sentence.id === undefined) return;

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        if (playingSentenceId === sentence.id) {
            setPlayingSentenceId(null);
            return;
        }

        const audio = new Audio(sentence.audio_url);
        audioRef.current = audio;
        setPlayingSentenceId(sentence.id);
        audio.addEventListener("ended", () => setPlayingSentenceId(null));
        audio.addEventListener("error", () => setPlayingSentenceId(null));
        audio.play().catch(() => setPlayingSentenceId(null));
    };

    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const { data, error } = await supabase
                    .from("categories")
                    .select("name")
                    .order("name");

                if (error) throw error;
                if (data) {
                    setCategories(data.map((c) => c.name));
                }
            } catch (err) {
                console.error("Error fetching categories:", err);
            }
        };

        fetchCategories();
    }, []);

    useEffect(() => {
        const fetchSentences = async () => {
            setSentencesLoading(true);
            try {
                const { data, error } = await supabase
                    .from("example_sentences")
                    .select("id, chinese, traditional, pinyin, english, audio_url")
                    .eq("character_id", character.id)
                    .order("id");

                if (error) throw error;
                const loaded: ExampleSentence[] = (data || []).map(s => ({
                    ...s,
                    traditional: s.traditional ?? "",
                }));
                setSentences(loaded);
                const originals = new Map<number, ExampleSentence>();
                for (const s of loaded) {
                    if (s.id !== undefined) originals.set(s.id, { ...s });
                }
                setOriginalSentences(originals);
            } catch (err) {
                console.error("Error fetching example sentences:", err);
            } finally {
                setSentencesLoading(false);
            }
        };

        fetchSentences();
    }, [character.id]);

    const handleSentenceChange = (index: number, field: keyof ExampleSentence, value: string) => {
        setSentences(prev => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const handleAddSentence = () => {
        setSentences(prev => [...prev, { chinese: "", traditional: "", pinyin: "", english: "" }]);
    };

    const handleRemoveSentence = (index: number) => {
        setSentences(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { error: charError } = await supabase
                .from("characters")
                .update({
                    pinyin: editingCharacter.pinyin,
                    meaning: editingCharacter.meaning,
                    character: editingCharacter.character,
                    freq_rank: editingCharacter.freq_rank,
                    hsk_level: editingCharacter.hsk_level,
                    category: editingCharacter.category,
                    visible: editingCharacter.visible,
                })
                .eq("id", editingCharacter.id);

            if (charError) throw charError;

            const currentIds = new Set(
                sentences.map(s => s.id).filter((id): id is number => id !== undefined)
            );
            const toDelete = [...originalSentences.keys()].filter(id => !currentIds.has(id));
            if (toDelete.length > 0) {
                const { error: delError } = await supabase
                    .from("example_sentences")
                    .delete()
                    .in("id", toDelete);
                if (delError) throw delError;
            }

            const toInsert = sentences
                .filter(s => s.id === undefined)
                .map(s => ({
                    character_id: editingCharacter.id,
                    chinese: s.chinese,
                    traditional: s.traditional,
                    pinyin: s.pinyin,
                    english: s.english,
                }));
            if (toInsert.length > 0) {
                const { error: insError } = await supabase
                    .from("example_sentences")
                    .insert(toInsert);
                if (insError) throw insError;
            }

            for (const s of sentences) {
                if (s.id === undefined) continue;
                const original = originalSentences.get(s.id);
                if (original
                    && original.chinese === s.chinese
                    && original.traditional === s.traditional
                    && original.pinyin === s.pinyin
                    && original.english === s.english
                ) continue;

                const { error: updError } = await supabase
                    .from("example_sentences")
                    .update({
                        chinese: s.chinese,
                        traditional: s.traditional,
                        pinyin: s.pinyin,
                        english: s.english,
                    })
                    .eq("id", s.id);
                if (updError) throw updError;
            }

            onSave();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Unknown error";
            alert("Error updating character: " + message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">Edit Character</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Character</label>
                                <input
                                    type="text"
                                    value={editingCharacter.character}
                                    onChange={(e) => setEditingCharacter({ ...editingCharacter, character: e.target.value })}
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Pinyin</label>
                                <input
                                    type="text"
                                    value={editingCharacter.pinyin}
                                    onChange={(e) => setEditingCharacter({ ...editingCharacter, pinyin: e.target.value })}
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Meaning</label>
                            <textarea
                                value={editingCharacter.meaning}
                                onChange={(e) => setEditingCharacter({ ...editingCharacter, meaning: e.target.value })}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                                rows={3}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700">HSK</label>
                                <input
                                    type="number"
                                    value={editingCharacter.hsk_level}
                                    onChange={(e) => setEditingCharacter({ ...editingCharacter, hsk_level: parseInt(e.target.value) })}
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700">Freq Rank</label>
                                <input
                                    type="number"
                                    value={editingCharacter.freq_rank}
                                    onChange={(e) => setEditingCharacter({ ...editingCharacter, freq_rank: parseInt(e.target.value) })}
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700">Category</label>
                            <select
                                value={editingCharacter.category}
                                onChange={(e) => setEditingCharacter({ ...editingCharacter, category: e.target.value })}
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 bg-white"
                            >
                                <option value="">Select...</option>
                                {categories.map((cat) => (
                                    <option key={cat} value={cat}>
                                        {cat}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center">
                            <input
                                id="visible"
                                type="checkbox"
                                checked={editingCharacter.visible}
                                onChange={(e) => setEditingCharacter({ ...editingCharacter, visible: e.target.checked })}
                                className="h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
                            />
                            <label htmlFor="visible" className="ml-2 block text-sm font-medium text-gray-700">
                                Visible to public
                            </label>
                        </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border h-[500px] flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-semibold text-gray-900">Example Sentences</h3>
                            <button
                                type="button"
                                onClick={handleAddSentence}
                                className="text-sm bg-white border px-3 py-1 rounded hover:bg-gray-100 shadow-sm flex items-center"
                            >
                                <span className="mr-1 text-green-600 font-bold">+</span> Add Sentence
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
                            {sentencesLoading ? (
                                <div className="text-center text-gray-400 py-10">
                                    Loading sentences...
                                </div>
                            ) : sentences.length === 0 ? (
                                <div className="text-center text-gray-400 py-10">
                                    No example sentences yet. Click &quot;Add Sentence&quot; to create one.
                                </div>
                            ) : (
                                sentences.map((sentence, index) => (
                                    <div key={index} className="bg-white p-3 rounded border shadow-sm relative group">
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveSentence(index)}
                                            className="absolute top-2 right-2 text-gray-300 hover:text-red-500 transition-colors"
                                            title="Delete Sentence"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>

                                        <div className="space-y-3">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Chinese (Simplified)</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={sentence.chinese}
                                                        onChange={(e) => handleSentenceChange(index, "chinese", e.target.value)}
                                                        className="block w-full border-gray-300 rounded-md shadow-sm p-1.5 text-sm border focus:ring-black focus:border-black"
                                                        placeholder="汉字..."
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePlayAudio(sentence)}
                                                        disabled={!sentence.audio_url}
                                                        title={sentence.audio_url ? "Play audio" : "No audio available"}
                                                        className="shrink-0 px-2 py-1 rounded-md border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                                                    >
                                                        {playingSentenceId === sentence.id ? (
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-700">
                                                                <path d="M5.5 3.5A1.5 1.5 0 017 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5zM13 3.5A1.5 1.5 0 0114.5 5v10a1.5 1.5 0 01-3 0V5A1.5 1.5 0 0113 3.5z" />
                                                            </svg>
                                                        ) : (
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-700">
                                                                <path d="M6.3 2.84A1 1 0 004.8 3.7v12.6a1 1 0 001.5.86l11-6.3a1 1 0 000-1.72l-11-6.3z" />
                                                            </svg>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Traditional</label>
                                                <input
                                                    type="text"
                                                    value={sentence.traditional}
                                                    onChange={(e) => handleSentenceChange(index, "traditional", e.target.value)}
                                                    className="block w-full border-gray-300 rounded-md shadow-sm p-1.5 text-sm border focus:ring-black focus:border-black"
                                                    placeholder="漢字..."
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 gap-2">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Pinyin</label>
                                                    <input
                                                        type="text"
                                                        value={sentence.pinyin}
                                                        onChange={(e) => handleSentenceChange(index, "pinyin", e.target.value)}
                                                        className="block w-full border-gray-300 rounded-md shadow-sm p-1.5 text-sm border focus:ring-black focus:border-black"
                                                        placeholder="Pinyin..."
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">English</label>
                                                    <input
                                                        type="text"
                                                        value={sentence.english}
                                                        onChange={(e) => handleSentenceChange(index, "english", e.target.value)}
                                                        className="block w-full border-gray-300 rounded-md shadow-sm p-1.5 text-sm border focus:ring-black focus:border-black"
                                                        placeholder="Meaning..."
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="md:col-span-2 flex justify-end gap-3 mt-4 pt-4 border-t">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2 bg-white text-gray-700 border rounded-lg hover:bg-gray-50 font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-black text-white rounded-lg hover:bg-gray-800 font-medium shadow-md disabled:opacity-50"
                        >
                            {loading ? "Saving..." : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

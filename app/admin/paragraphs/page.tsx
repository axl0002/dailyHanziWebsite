"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

function bucketLabel(bucketKey: string): string {
    // "1-early" → "HSK 1 easy", "1-late" → "HSK 1 hard", etc.
    const match = bucketKey.match(/^(\d+)-(early|late)$/);
    if (!match) return bucketKey;
    const [, level, phase] = match;
    return `HSK ${level} ${phase === 'early' ? 'easy' : 'hard'}`;
}

type Paragraph = {
    id: number;
    bucket_key: string;
    paragraph_date: string;
    variant: number;
    topic: string | null;
    title: string | null;
    chinese: string | null;
    pinyin: string | null;
    english: string | null;
    audio_url: string | null;
    status: string | null;
    model: string | null;
    created_at: string;
};

export default function ParagraphsPage() {
    const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [availableDates, setAvailableDates] = useState<string[]>([]);
    const [availableBuckets, setAvailableBuckets] = useState<string[]>([]);
    const [date, setDate] = useState<string>("");        // '' = all dates
    const [bucket, setBucket] = useState<string>("");    // '' = all buckets

    // Load distinct dates + buckets for the filter dropdowns.
    useEffect(() => {
        const loadFilters = async () => {
            const { data, error: qerr } = await supabase
                .from("daily_paragraphs")
                .select("paragraph_date, bucket_key")
                .order("paragraph_date", { ascending: false })
                .limit(2000);
            if (qerr) {
                setError(qerr.message);
                return;
            }
            const dates = Array.from(new Set((data || []).map((r) => r.paragraph_date))).sort((a, b) => b.localeCompare(a));
            const buckets = Array.from(new Set((data || []).map((r) => r.bucket_key))).sort();
            setAvailableDates(dates);
            setAvailableBuckets(buckets);
            if (!date && dates.length > 0) setDate(dates[0]);   // default to latest date
        };
        loadFilters();
    }, [date]);

    const fetchParagraphs = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let query = supabase
                .from("daily_paragraphs")
                .select("id, bucket_key, paragraph_date, variant, topic, title, chinese, pinyin, english, audio_url, status, model, created_at")
                .order("paragraph_date", { ascending: false })
                .order("bucket_key", { ascending: true })
                .order("variant", { ascending: true })
                .limit(200);
            if (date) query = query.eq("paragraph_date", date);
            if (bucket) query = query.eq("bucket_key", bucket);
            const { data, error: qerr } = await query;
            if (qerr) throw new Error(qerr.message);
            setParagraphs(data || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    }, [date, bucket]);

    useEffect(() => {
        fetchParagraphs();
    }, [fetchParagraphs]);

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">Paragraphs</h1>
                <p className="text-gray-600 mt-1">Review daily paragraphs — check Chinese, pinyin, and English translations.</p>
            </div>

            <div className="mb-6 flex flex-wrap gap-3 items-end">
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                    <select
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[160px] bg-white"
                    >
                        <option value="">All dates</option>
                        {availableDates.map((d) => (
                            <option key={d} value={d}>{d}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Bucket</label>
                    <select
                        value={bucket}
                        onChange={(e) => setBucket(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[160px] bg-white"
                    >
                        <option value="">All buckets</option>
                        {availableBuckets.map((b) => (
                            <option key={b} value={b}>{bucketLabel(b)}</option>
                        ))}
                    </select>
                </div>
                <div className="text-xs text-gray-500 ml-auto">
                    {paragraphs.length} paragraph{paragraphs.length === 1 ? "" : "s"} shown
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-700 border border-red-200 rounded-md text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100 text-center text-gray-500">
                    Loading paragraphs…
                </div>
            ) : paragraphs.length === 0 ? (
                <div className="bg-white p-8 rounded-lg shadow-sm border border-gray-100 text-center text-gray-500">
                    No paragraphs found.
                </div>
            ) : (
                <div className="space-y-4">
                    {paragraphs.map((p) => (
                        <ParagraphCard key={p.id} p={p} />
                    ))}
                </div>
            )}
        </div>
    );
}

function ParagraphCard({ p }: { p: Paragraph }) {
    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
                <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full font-medium">
                    {p.paragraph_date}
                </span>
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full font-medium">
                    {bucketLabel(p.bucket_key)}
                </span>
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">
                    variant {p.variant}
                </span>
                {p.status && (
                    <span className={`px-2 py-0.5 rounded-full font-medium ${p.status === 'approved' ? 'bg-green-100 text-green-800'
                        : p.status === 'rejected' ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'}`}>
                        {p.status}
                    </span>
                )}
                {p.model && (
                    <span className="text-gray-400">{p.model}</span>
                )}
                {p.topic && (
                    <span className="text-gray-500 italic">· {p.topic}</span>
                )}
                <span className="ml-auto text-gray-400 font-mono">#{p.id}</span>
            </div>

            {p.title && (
                <h3 className="text-xl font-bold text-gray-900 mb-3">{p.title}</h3>
            )}

            <div className="space-y-3">
                <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Chinese</div>
                    <p className="text-lg text-gray-900 leading-relaxed">{p.chinese || <span className="text-red-500">MISSING</span>}</p>
                </div>
                <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Pinyin</div>
                    <p className="text-sm text-gray-700 italic leading-relaxed">{p.pinyin || <span className="text-red-500">MISSING</span>}</p>
                </div>
                <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">English</div>
                    <p className="text-sm text-gray-800 leading-relaxed">{p.english || <span className="text-red-500">MISSING</span>}</p>
                </div>
                {p.audio_url ? (
                    <div>
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Audio</div>
                        <audio controls preload="none" className="w-full max-w-md h-10">
                            <source src={p.audio_url} type="audio/mpeg" />
                        </audio>
                    </div>
                ) : (
                    <div className="text-xs text-red-500">Audio MISSING</div>
                )}
            </div>
        </div>
    );
}

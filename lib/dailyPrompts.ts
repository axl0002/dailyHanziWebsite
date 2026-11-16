export type DailyPrompt = {
    id: string;
    slug: string;
    response_type: string;
    title: string | null;
    instructions_en: string | null;
    instructions_zh: string | null;
    starter_zh: string | null;
    starter_en: string | null;
    hints: unknown;
    active: boolean;
    created_at: string;
    last_used_on: string | null;
    question_audio_url: string | null;
    starter_audio_url: string | null;
};

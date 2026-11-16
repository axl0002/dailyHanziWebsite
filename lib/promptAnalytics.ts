export type PromptStat = { date: string; prompt_id: string; title: string; slug: string; response_type: string; assigned: number; responded: number };
export const responseTypes = ['handwriting', 'photo', 'sentence', 'voice'] as const;
export type PromptRank = { id: string; title: string; slug: string; type: string; assigned: number; responded: number; rate: number };
export function summarizePrompts(rows: PromptStat[], dates: string[]) {
    const prompts = new Map<string, PromptRank>();
    const daily = dates.map(date => ({ date, counts: Object.fromEntries(responseTypes.map(type => [type, { assigned: 0, responded: 0, rate: null as number | null }])) }));
    const days = new Map(daily.map(day => [day.date, day]));
    for (const row of rows) {
        const day = days.get(row.date);
        if (!day || !day.counts[row.response_type]) continue;
        const assigned = Number(row.assigned), responded = Number(row.responded);
        const counts = day.counts[row.response_type];
        counts.assigned += assigned; counts.responded += responded;
        const prompt = prompts.get(row.prompt_id) ?? { id: row.prompt_id, title: row.title, slug: row.slug, type: row.response_type, assigned: 0, responded: 0, rate: 0 };
        prompt.assigned += assigned; prompt.responded += responded;
        prompts.set(row.prompt_id, prompt);
    }
    for (const day of daily) for (const count of Object.values(day.counts)) count.rate = count.assigned ? Math.round(count.responded / count.assigned * 1000) / 10 : null;
    for (const prompt of prompts.values()) prompt.rate = prompt.assigned ? Math.round(prompt.responded / prompt.assigned * 1000) / 10 : 0;
    const assigned = daily.reduce((sum, day) => sum + Object.values(day.counts).reduce((n, c) => n + c.assigned, 0), 0);
    const responded = daily.reduce((sum, day) => sum + Object.values(day.counts).reduce((n, c) => n + c.responded, 0), 0);
    return { daily, prompts: [...prompts.values()], assigned, responded, rate: assigned ? Math.round(responded / assigned * 1000) / 10 : null };
}

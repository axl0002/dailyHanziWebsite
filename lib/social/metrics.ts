export type Platform = 'instagram' | 'tiktok'
export type Snapshot = {
    platform: Platform; account_id: string; post_id: string; day: string; observed_at: string;
    label: string; caption: string; format: string; permalink: string | null; published_at: string;
    views: number | null; likes: number | null; comments: number | null; shares: number | null;
}
export function counter(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
// Missing days are not interpolated: a multi-day change is not a daily metric.
export function dailyGain(current: Snapshot, previous?: Snapshot): number | null {
    if (!previous || current.views === null || previous.views === null) return null
    if (Date.parse(`${current.day}T00:00:00Z`) - Date.parse(`${previous.day}T00:00:00Z`) !== 86400000) return null
    const gain = current.views - previous.views
    return gain >= 0 ? gain : null // Counter corrections need a new baseline.
}
export function safePostUrl(value: unknown, platform: Platform): string | null {
    try {
        const url = new URL(String(value))
        const domain = platform === 'instagram' ? 'instagram.com' : 'tiktok.com'
        return url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null
    } catch { return null }
}
export function summarize(snapshots: Snapshot[], start: string, end: string) {
    const previous = new Map<string, Snapshot>()
    const daily = new Map<string, { day: string; instagram: number | null; tiktok: number | null }>()
    const posts = new Map<string, Snapshot & { gain: number | null; measuredDays: number }>()
    for (const row of [...snapshots].sort((a, b) => a.day.localeCompare(b.day))) {
        const key = `${row.platform}:${row.account_id}:${row.post_id}`
        const gain = dailyGain(row, previous.get(key))
        previous.set(key, row)
        if (row.day < start || row.day > end) continue
        const day = daily.get(row.day) ?? { day: row.day, instagram: null, tiktok: null }
        if (gain !== null) day[row.platform] = (day[row.platform] ?? 0) + gain
        daily.set(row.day, day)
        const post = posts.get(key)
        posts.set(key, { ...row, gain: gain === null ? post?.gain ?? null : (post?.gain ?? 0) + gain,
            measuredDays: (post?.measuredDays ?? 0) + (gain === null ? 0 : 1) })
    }
    return { daily: [...daily.values()], posts: [...posts.values()].sort((a, b) => (b.gain ?? -1) - (a.gain ?? -1)) }
}

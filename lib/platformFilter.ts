export type PlatformFilter = 'all' | 'ios' | 'android';
export const platformScopes: PlatformFilter[] = ['all', 'ios', 'android'];
export function filterPlatformRows<T extends { platform?: string | null; store?: string | null }>(rows: T[], platform: PlatformFilter): T[] {
    if (platform === 'all') return rows;
    return rows.filter(row => {
        if (row.store !== undefined) return row.store === (platform === 'ios' ? 'APP_STORE' : 'PLAY_STORE');
        return row.platform?.toLowerCase() === platform;
    });
}

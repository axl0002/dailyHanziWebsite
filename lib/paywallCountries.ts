import { getCountryForTimezone } from 'countries-and-timezones';

export type PaywallProfile = { created_at: string; is_pro: boolean | null; timezone: string | null };
export type CountryDay = { date: string; rates: Record<string, number | null>; counts: Record<string, { pro: number; total: number }> };
export type CountrySeries = { countries: string[]; data: CountryDay[] };

export function paywallCountries(profiles: PaywallProfile[], dates: string[]): CountrySeries {
    const visible = new Set(dates);
    const totals = new Map<string, number>();
    const buckets = new Map<string, Record<string, { pro: number; total: number }>>();
    for (const profile of profiles) {
        const date = profile.created_at?.slice(0, 10);
        if (!visible.has(date) || !profile.timezone?.trim()) continue;
        let country: string | undefined;
        try { country = getCountryForTimezone(profile.timezone.trim())?.name; } catch { continue; }
        if (!country) continue;
        totals.set(country, (totals.get(country) ?? 0) + 1);
        const day = buckets.get(date) ?? {};
        const count = day[country] ?? { pro: 0, total: 0 };
        count.total++;
        if (profile.is_pro) count.pro++;
        day[country] = count;
        buckets.set(date, day);
    }
    const countries = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 7).map(([name]) => name);
    return { countries, data: dates.map(date => {
        const counts = Object.fromEntries(countries.map(country => [country, buckets.get(date)?.[country] ?? { pro: 0, total: 0 }]));
        return { date, counts, rates: Object.fromEntries(countries.map(country => {
            const { pro, total } = counts[country];
            return [country, total ? Math.round(pro / total * 1000) / 10 : null];
        })) };
    }) };
}

"use client";

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { CountryDay, CountrySeries } from '@/lib/paywallCountries';

const colors = ['#6366F1', '#059669', '#DC2626', '#D97706', '#0891B2', '#9333EA', '#DB2777'];

export default function PaywallCountryChart({ series, error, metric = 'conversion' }: { series: CountrySeries; error: string; metric?: 'conversion' | 'signups' }) {
    const signups = metric === 'signups';
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const toggleCountry = (country: string) => setHidden(previous => {
        const next = new Set(previous);
        if (next.has(country)) next.delete(country);
        else next.add(country);
        return next;
    });
    return <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-full">
        <h3 className="text-lg font-bold text-gray-900">{signups ? 'Signups by country' : 'Paywall conversion by country'}</h3>
        <p className="text-sm text-gray-500 mt-1 mb-5">Top 7 countries by signups in the period above. {signups ? 'Daily signup counts, excluding beta users.' : 'Current Pro users ÷ signups for each signup day, excluding beta users.'} Country is inferred from timezone; unknown countries are excluded. Uses the date controls above. Click a legend to hide or show its line.</p>
        {error ? <p role="alert" className="text-red-600">{error}</p> : !series.countries.length ? <p className="text-gray-500">No country data available for this period.</p> : <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} minTickGap={25} tick={{ fontSize: 12 }} />
                    <YAxis domain={signups ? [0, 'auto'] : [0, 100]} allowDecimals={!signups} tickFormatter={value => signups ? String(value) : `${value}%`} tick={{ fontSize: 12 }} />
                    <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const day = payload[0].payload as CountryDay;
                        const rankedCountries = series.countries
                            .map((country, index) => ({ country, color: colors[index], value: signups ? day.counts[country].total : day.rates[country] }))
                            .filter(({ country }) => !hidden.has(country))
                            .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.country.localeCompare(b.country));
                        return <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg text-sm">
                            <p className="font-semibold mb-2">{label}</p>
                            {rankedCountries.map(({ country, color }) => <p key={country} style={{ color }}>{country}: {signups ? `${day.counts[country].total} signups` : day.rates[country] === null ? 'No signups' : `${day.rates[country]}% (${day.counts[country].pro}/${day.counts[country].total})`}</p>)}
                        </div>;
                    }} />
                    <Legend content={() => <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pt-3">
                        {series.countries.map((country, i) => <button key={country} type="button" aria-pressed={!hidden.has(country)} onClick={() => toggleCountry(country)}
                            title={`${hidden.has(country) ? 'Show' : 'Hide'} ${country}`} className={`flex items-center gap-1.5 text-sm rounded px-1 focus-visible:outline-2 focus-visible:outline-offset-2 ${hidden.has(country) ? 'opacity-40 line-through' : ''}`}>
                            <span aria-hidden="true" className="inline-block w-4 h-0.5" style={{ backgroundColor: colors[i] }} />{country}
                        </button>)}
                    </div>} />
                    {series.countries.map((country, i) => <Line key={country} name={country} hide={hidden.has(country)} dataKey={row => signups ? (row as CountryDay).counts[country].total : (row as CountryDay).rates[country]} stroke={colors[i]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />)}
                </LineChart>
            </ResponsiveContainer>
        </div>}
    </div>;
}

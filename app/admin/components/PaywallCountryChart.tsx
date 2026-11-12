"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { CountryDay, CountrySeries } from '@/lib/paywallCountries';

const colors = ['#6366F1', '#059669', '#DC2626', '#D97706', '#0891B2', '#9333EA', '#DB2777'];

export default function PaywallCountryChart({ series, error }: { series: CountrySeries; error: string }) {
    return <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 col-span-full">
        <h3 className="text-lg font-bold text-gray-900">Paywall conversion by country</h3>
        <p className="text-sm text-gray-500 mt-1 mb-5">Top 7 countries by signups in the period above. Current Pro users ÷ signups for each signup day, excluding beta users. Country is inferred from timezone; unknown countries are excluded. Uses the date controls above.</p>
        {error ? <p role="alert" className="text-red-600">{error}</p> : !series.countries.length ? <p className="text-gray-500">No country data available for this period.</p> : <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="date" tickFormatter={date => String(date).slice(5)} minTickGap={25} tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tickFormatter={value => `${value}%`} tick={{ fontSize: 12 }} />
                    <Tooltip content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const day = payload[0].payload as CountryDay;
                        return <div className="bg-white p-3 border border-gray-200 shadow-lg rounded-lg text-sm">
                            <p className="font-semibold mb-2">{label}</p>
                            {series.countries.map((country, i) => <p key={country} style={{ color: colors[i] }}>{country}: {day.rates[country] === null ? 'No signups' : `${day.rates[country]}% (${day.counts[country].pro}/${day.counts[country].total})`}</p>)}
                        </div>;
                    }} />
                    <Legend />
                    {series.countries.map((country, i) => <Line key={country} name={country} dataKey={row => (row as CountryDay).rates[country]} stroke={colors[i]} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />)}
                </LineChart>
            </ResponsiveContainer>
        </div>}
    </div>;
}

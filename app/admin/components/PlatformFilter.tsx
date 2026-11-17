"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { platformScopes, type PlatformFilter } from '@/lib/platformFilter';
const Context = createContext<{ platform: PlatformFilter; setPlatform: (value: PlatformFilter) => void }>({ platform: 'all', setPlatform: () => {} });
export function PlatformProvider({ children }: { children: ReactNode }) {
    const [platform, setValue] = useState<PlatformFilter>('all');
    useEffect(() => {
        try { const saved = sessionStorage.getItem('hanzi-admin-platform'); if (platformScopes.includes(saved as PlatformFilter)) setValue(saved as PlatformFilter); } catch {}
    }, []);
    const setPlatform = (value: PlatformFilter) => {
        setValue(value);
        try { sessionStorage.setItem('hanzi-admin-platform', value); } catch {}
    };
    return <Context.Provider value={{ platform, setPlatform }}>{children}</Context.Provider>;
}
export function usePlatformFilter() { return useContext(Context).platform; }
export function PlatformToggle() {
    const { platform, setPlatform } = useContext(Context);
    return <div className="flex flex-wrap gap-2 items-center mb-4"><span className="text-sm font-medium text-gray-600">Platform</span><div className="bg-white p-1 rounded-lg border border-gray-200 flex shadow-sm" role="group" aria-label="Platform filter">
        {platformScopes.map(value => <button key={value} type="button" aria-pressed={platform === value} onClick={() => setPlatform(value)} className={`px-4 py-2 text-sm font-medium rounded-md ${platform === value ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}>{value === 'all' ? 'Both' : value === 'ios' ? 'iOS' : 'Android'}</button>)}
    </div></div>;
}
// Each fetch prepares all platform slices once. Selecting a slice changes only
// the value returned by this hook; it never changes the fetch effect's inputs.
export function usePlatformState<T>(initial: T): [T, (value: T, scope?: PlatformFilter) => void] {
    const platform = usePlatformFilter();
    const [slices, setSlices] = useState<Record<PlatformFilter, T>>({ all: initial, ios: initial, android: initial });
    const setSlice = useCallback((value: T, scope: PlatformFilter = 'all') => setSlices(previous => ({ ...previous, [scope]: value })), []);
    return [slices[platform], setSlice];
}

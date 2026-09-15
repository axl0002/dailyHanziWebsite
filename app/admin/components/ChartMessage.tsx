"use client";

// Small reusable card matching the analytics chart chrome, used for the
// loading / error / empty / Pro-only-empty states so each chart doesn't
// re-declare the same wrapper markup.

const CARD = "bg-white p-6 rounded-lg shadow-sm border border-gray-100 flex flex-col items-center justify-center h-[300px]";

export function ChartLoading() {
    return (
        <div className={CARD}>
            <span className="text-gray-400">Loading chart data...</span>
        </div>
    );
}

export function ChartError({ title, error, onRetry }: { title: string; error: string; onRetry: () => void }) {
    return (
        <div className={`${CARD} gap-2`}>
            <p className="text-red-600 font-medium">Failed to load {title}</p>
            <p className="text-xs text-gray-500 text-center max-w-xs">{error}</p>
            <button
                onClick={onRetry}
                className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
            >
                Retry
            </button>
        </div>
    );
}

export function ChartEmpty({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className={CARD}>
            <p className="text-gray-500 font-medium">{title}</p>
            {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
        </div>
    );
}

// The "Pro feature — no data for Free users" placeholder that the post-paywall
// charts render when the toolbar is on filter=false. Same visual, but uses the
// wider md:col-span-2 lg:col-span-1 to stay grid-aligned like the real chart.
export function ChartProOnlyPlaceholder({ title }: { title: string }) {
    return (
        <div className={`${CARD} md:col-span-2 lg:col-span-1`}>
            <p className="text-gray-500 font-medium">{title}</p>
            <p className="text-xs text-gray-400 mt-1">Pro feature — no data to show for Free users.</p>
        </div>
    );
}

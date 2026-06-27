"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

import ReferralChart from "../components/ReferralChart";
import UserGrowthChart from "../components/UserGrowthChart";
import HourlyGrowthChart from "../components/HourlyGrowthChart";
import ReadingHoursChart from "../components/ReadingHoursChart";
import HSKLevelChart from "../components/HSKLevelChart";
import ReasonChart from "../components/ReasonChart";
import TimezoneChart from "../components/TimezoneChart";
import ContinentChart from "../components/ContinentChart";
import CountryChart from "../components/CountryChart";
import CategoryChart from "../components/CategoryChart";
import ProUserPercentageChart from "../components/ProUserPercentageChart";
import ReferralByDayChart from "../components/ReferralByDayChart";
import PlatformByDayChart from "../components/PlatformByDayChart";
import PlatformChart from "../components/PlatformChart";
import TimezoneByDayChart from "../components/TimezoneByDayChart";
import TrialCancellationChart from "../components/TrialCancellationChart";
import { useDateLabels } from "../components/useDateLabels";

export default function AdminDashboard() {
    const [filter, setFilter] = useState<'all' | 'true' | 'false'>('all');
    const [userCount, setUserCount] = useState<number | null>(null);
    const { labels, addLabel, deleteLabel } = useDateLabels();

    useEffect(() => {
        const fetchUserCount = async () => {
            let query = supabase
                .from('profiles')
                .select('*', { count: 'exact', head: true })
                .eq('is_beta', false);

            if (filter === 'true') {
                query = query.eq('is_pro', true);
            } else if (filter === 'false') {
                query = query.eq('is_pro', false);
            }

            const { count, error } = await query;

            if (!error && count !== null) {
                setUserCount(count);
            }
        };

        fetchUserCount();
    }, [filter]);

    return (
        <div className="p-6">
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
                    <p className="text-gray-600 mt-1">Overview of Daily Hanzi performance and user metrics.</p>
                    {userCount !== null && (
                        <div className="mt-4 flex items-center">
                            <span className="bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-0.5 rounded-full border border-indigo-200">
                                {userCount} Users Found
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex flex-col items-end">
                    <div className="bg-white p-1 rounded-lg border border-gray-200 flex shadow-sm">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            All Users
                        </button>
                        <button
                            onClick={() => setFilter('true')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'true' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            Pro Users
                        </button>
                        <button
                            onClick={() => setFilter('false')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${filter === 'false' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            Free Users
                        </button>
                    </div>
                    <div className="mt-2 text-xs text-gray-400 text-right">
                        <p><span className="font-medium text-gray-500">Pro Users:</span> Everyone who passed the paywall</p>
                        <p><span className="font-medium text-gray-500">Free Users:</span> Everyone who did not pass the paywall</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Analytics Section */}
                <div className="col-span-1 md:col-span-2">
                    <UserGrowthChart filter={filter} dateLabels={labels} onAddLabel={addLabel} onDeleteLabel={deleteLabel} />
                </div>
                <div className="col-span-1 md:col-span-2">
                    <ReferralByDayChart filter={filter} dateLabels={labels} onAddLabel={addLabel} onDeleteLabel={deleteLabel} />
                </div>
                <div className="col-span-1 md:col-span-2">
                    <PlatformByDayChart filter={filter} dateLabels={labels} onAddLabel={addLabel} onDeleteLabel={deleteLabel} />
                </div>
                <div className="col-span-1 md:col-span-2">
                    <TimezoneByDayChart filter={filter} dateLabels={labels} onAddLabel={addLabel} onDeleteLabel={deleteLabel} />
                </div>
                <div className="col-span-1 md:col-span-2">
                    <ProUserPercentageChart dateLabels={labels} onAddLabel={addLabel} onDeleteLabel={deleteLabel} />
                </div>
                <div className="col-span-1 md:col-span-2">
                    <HourlyGrowthChart filter={filter} />
                </div>
                <div className="col-span-1 md:col-span-2">
                    <TrialCancellationChart />
                </div>
                <ReadingHoursChart filter={filter} />
                <HSKLevelChart filter={filter} />
                <ReasonChart filter={filter} />
                <ReferralChart filter={filter} />
                <CategoryChart filter={filter} />
                <ContinentChart filter={filter} />
                <CountryChart filter={filter} />
                <TimezoneChart filter={filter} />
                <PlatformChart filter={filter} />
            </div>
        </div>
    );
}

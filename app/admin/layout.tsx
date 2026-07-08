"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [loading, setLoading] = useState(true);
    const [collapsed, setCollapsed] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        const checkUser = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!session && pathname !== "/admin/login") {
                router.push("/admin/login");
                setLoading(false);
                return;
            }

            if (session) {
                // Allow admins and moderators into the admin area
                const { data: roleRows, error } = await supabase
                    .from("user_roles")
                    .select("role")
                    .eq("user_id", session.user.id)
                    .in("role", ["admin", "moderator"]);

                const roleList = roleRows?.map((r) => r.role) ?? [];
                const admin = roleList.includes("admin");
                setIsAdmin(admin);

                // Moderators can't view the revenue dashboard; bounce to reports.
                // (Middleware enforces this server-side; this covers client nav.)
                if (!admin && pathname.startsWith("/admin/dashboard")) {
                    router.replace("/admin/sentence-reports");
                }

                if (error || roleList.length === 0) {
                    // Start Debug Block
                    setLoading(false);
                    return (
                        <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 p-4">
                            <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
                            <div className="bg-white p-6 rounded shadow max-w-lg w-full overflow-auto">
                                <p className="mb-2"><strong>User ID:</strong> {session.user.id}</p>
                                <p className="mb-2"><strong>Email:</strong> {session.user.email}</p>
                                <p className="mb-2"><strong>Database Error:</strong> {error?.message || "Role not found"}</p>
                                <p className="text-sm text-gray-500 mt-4">
                                    with this exact <strong>User ID</strong> and role <strong>&apos;admin&apos;</strong>.
                                </p>
                                <button
                                    onClick={() => window.location.reload()}
                                    className="mt-6 bg-blue-500 text-white px-4 py-2 rounded"
                                >
                                    Retry
                                </button>
                                <button
                                    onClick={async () => {
                                        await supabase.auth.signOut();
                                        router.push("/admin/login");
                                    }}
                                    className="mt-2 ml-2 text-gray-600 hover:text-black underline"
                                >
                                    Sign Out
                                </button>
                            </div>
                        </div>
                    );
                    // End Debug Block
                }
            }
            setLoading(false);
        };

        checkUser();
    }, [router, pathname]);

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    // If on login page, don't show the admin sidebar
    if (pathname === "/admin/login") {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen bg-gray-100">
            {/* Sidebar */}
            <aside
                className={`${collapsed ? 'w-20' : 'w-64'} bg-white shadow-md transition-all duration-300 flex flex-col`}
            >
                <div className="p-4 flex items-center justify-between border-b">
                    {!collapsed && <h1 className="text-xl font-bold text-gray-800 truncate">Admin</h1>}
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="p-2 rounded hover:bg-gray-100 text-gray-500 ml-auto"
                        title={collapsed ? "Expand" : "Collapse"}
                    >
                        {collapsed ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15l-7.5-7.5 7.5-7.5" />
                            </svg>
                        )}
                    </button>
                </div>

                <nav className="mt-6 px-2 space-y-2 flex-grow">
                    {isAdmin && (
                        <NavItem
                            href="/admin/dashboard"
                            active={pathname === "/admin/dashboard"}
                            collapsed={collapsed}
                            icon={
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                                </svg>
                            }
                            label="Dashboard"
                        />
                    )}
                    <NavItem
                        href="/admin/sentence-reports"
                        active={pathname === "/admin/sentence-reports"}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                            </svg>
                        }
                        label="Sentence Reports"
                    />
                    <NavItem
                        href="/admin/character-reports"
                        active={pathname === "/admin/character-reports"}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                            </svg>
                        }
                        label="Character Reports"
                    />
                    <NavItem
                        href="/admin/characters"
                        active={pathname === "/admin/characters"}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                            </svg>
                        }
                        label="Characters"
                    />
                    <NavItem
                        href="/admin/decks"
                        active={pathname.startsWith("/admin/decks")}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
                            </svg>
                        }
                        label="Decks"
                    />
                    <NavItem
                        href="/admin/paragraphs"
                        active={pathname === "/admin/paragraphs"}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                            </svg>
                        }
                        label="Paragraphs"
                    />
                    <NavItem
                        href="/admin/super-users"
                        active={pathname === "/admin/super-users"}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
                            </svg>
                        }
                        label="Super Users"
                    />
                    <NavItem
                        href="/admin/user-base"
                        active={pathname === "/admin/user-base"}
                        collapsed={collapsed}
                        icon={
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                            </svg>
                        }
                        label="User Base"
                    />
                </nav>

                <div className="p-4 border-t">
                    <button
                        onClick={async () => {
                            await supabase.auth.signOut();
                            router.push("/admin/login");
                        }}
                        className={`w-full flex items-center ${collapsed ? 'justify-center' : 'px-4'} py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors`}
                        title="Sign Out"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                        </svg>
                        {!collapsed && <span className="ml-3">Sign Out</span>}
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto p-8">
                {children}
            </main>
        </div>
    );
}

function NavItem({ href, active, collapsed, icon, label }: { href: string; active: boolean; collapsed: boolean; icon: React.ReactNode; label: string }) {
    return (
        <Link
            href={href}
            className={`flex items-center ${collapsed ? 'justify-center' : 'px-4'} py-2 rounded-lg text-sm font-medium transition-colors ${active
                ? "bg-primary/10 text-primary"
                : "text-gray-600 hover:bg-gray-50"
                }`}
            title={collapsed ? label : undefined}
        >
            {icon}
            {!collapsed && <span className="ml-3">{label}</span>}
        </Link>
    );
}

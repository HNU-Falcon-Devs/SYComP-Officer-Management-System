"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    BookUser,
    CalendarDays,
    CheckSquare,
    FileSpreadsheet,
    FolderOpen,
    GraduationCap,
    LayoutDashboard,
    LogOut,
    Megaphone,
    Menu,
    PanelLeftClose,
    PanelLeftOpen,
    QrCode,
    ScrollText,
    Settings,
    UserCircle,
    UsersRound,
    type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import type { SessionActorDto } from "@/lib/auth/dto";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandMark } from "./brand-mark";
import { SecurityOnboardingBanner } from "./security-onboarding-banner";

interface NavItem {
    label: string;
    href: string;
    icon: LucideIcon;
    roles: readonly SystemRole[];
    implementedInM2?: boolean;
}

interface NavGroup {
    title: string;
    items: readonly NavItem[];
}

const ALL_OPERATIONAL: readonly SystemRole[] = ["OFFICER", "EXECUTIVE", "SUPER_ADMIN"];
const EXEC_AND_ADMIN: readonly SystemRole[] = ["EXECUTIVE", "SUPER_ADMIN"];

const NAV_GROUPS: readonly NavGroup[] = [
    {
        title: "Core",
        items: [
            {
                label: "Dashboard",
                href: ROUTES.workspace.dashboard,
                icon: LayoutDashboard,
                roles: ALL_OPERATIONAL,
                implementedInM2: true,
            },
            {
                label: "QR Scanner",
                href: ROUTES.workspace.scanner,
                icon: QrCode,
                roles: ALL_OPERATIONAL,
            },
        ],
    },
    {
        title: "Operations",
        items: [
            {
                label: "Events & Proposals",
                href: ROUTES.workspace.events,
                icon: CalendarDays,
                roles: ALL_OPERATIONAL,
            },
            {
                label: "My Tasks",
                href: ROUTES.workspace.tasks,
                icon: CheckSquare,
                roles: ALL_OPERATIONAL,
            },
            {
                label: "Officer Meetings",
                href: ROUTES.workspace.meetings,
                icon: UsersRound,
                roles: ALL_OPERATIONAL,
            },
            {
                label: "Documents",
                href: ROUTES.workspace.documents,
                icon: FolderOpen,
                roles: ALL_OPERATIONAL,
            },
            {
                label: "Announcements",
                href: ROUTES.workspace.announcements,
                icon: Megaphone,
                roles: ALL_OPERATIONAL,
            },
        ],
    },
    {
        title: "Organization",
        items: [
            {
                label: "Directory",
                href: ROUTES.workspace.directory,
                icon: BookUser,
                roles: ALL_OPERATIONAL,
            },
            {
                label: "Account Security",
                href: ROUTES.workspace.account,
                icon: UserCircle,
                roles: ALL_OPERATIONAL,
                implementedInM2: true,
            },
        ],
    },
    {
        title: "Governance",
        items: [
            {
                label: "Terms & Officers",
                href: ROUTES.admin.terms,
                icon: GraduationCap,
                roles: ALL_OPERATIONAL,
            },
            {
                label: "Masterlist Import",
                href: ROUTES.admin.masterlist,
                icon: FileSpreadsheet,
                roles: EXEC_AND_ADMIN,
            },
            {
                label: "Audit Logs",
                href: ROUTES.admin.auditLogs,
                icon: ScrollText,
                roles: EXEC_AND_ADMIN,
            },
            {
                label: "System Settings",
                href: ROUTES.admin.settings,
                icon: Settings,
                roles: EXEC_AND_ADMIN,
            },
        ],
    },
];

const SIDEBAR_STORAGE_KEY = "sycomp_sidebar_collapsed";

function subscribeSidebarStorage(callback: () => void) {
    window.addEventListener("storage", callback);
    window.addEventListener("sycomp-sidebar-toggle", callback);
    return () => {
        window.removeEventListener("storage", callback);
        window.removeEventListener("sycomp-sidebar-toggle", callback);
    };
}

function getSidebarCollapsedSnapshot() {
    try {
        return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function formatRoleBadge(role: SystemRole) {
    if (role === "SUPER_ADMIN") return { label: "SUPER ADMIN", variant: "warning" as const };
    if (role === "EXECUTIVE") return { label: "EXECUTIVE", variant: "brand" as const };
    return { label: "OFFICER", variant: "info" as const };
}

export interface ActiveTermSummary {
    code: string;
    name: string;
}

interface ShellBProps {
    actor: SessionActorDto;
    activeTerm: ActiveTermSummary | null;
    children: ReactNode;
}

function SidebarNavList({
    role,
    pathname,
    collapsed,
    onNavigate,
}: {
    role: SystemRole;
    pathname: string;
    collapsed: boolean;
    onNavigate?: () => void;
}) {
    return (
        <nav aria-label="Workspace navigation" className="flex flex-col gap-5">
            {NAV_GROUPS.map((group) => {
                const visibleItems = group.items.filter((item) => item.roles.includes(role));
                if (visibleItems.length === 0) {
                    return null;
                }

                return (
                    <div key={group.title} className="flex flex-col gap-1">
                        {!collapsed ? (
                            <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                                {group.title}
                            </div>
                        ) : null}
                        {visibleItems.map((item) => {
                            const Icon = item.icon;
                            const isActive =
                                pathname === item.href || pathname.startsWith(`${item.href}/`);

                            if (!item.implementedInM2) {
                                return (
                                    <span
                                        key={item.href}
                                        aria-disabled="true"
                                        title={
                                            collapsed
                                                ? `${item.label} (Upcoming module)`
                                                : "Upcoming milestone module"
                                        }
                                        className={cn(
                                            "flex h-10 cursor-not-allowed items-center gap-2.5 rounded-md px-3 text-sm font-medium text-muted-foreground/60",
                                            collapsed && "justify-center px-0",
                                        )}
                                    >
                                        <Icon
                                            className="size-5 shrink-0"
                                            strokeWidth={1.75}
                                            aria-hidden="true"
                                        />
                                        {!collapsed ? (
                                            <>
                                                <span className="truncate">{item.label}</span>
                                                <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                                                    Soon
                                                </span>
                                            </>
                                        ) : null}
                                    </span>
                                );
                            }

                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={onNavigate}
                                    aria-current={isActive ? "page" : undefined}
                                    title={collapsed ? item.label : undefined}
                                    className={cn(
                                        "flex h-10 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors duration-150",
                                        collapsed && "justify-center px-0",
                                        isActive
                                            ? "bg-brand-soft text-primary dark:text-brand-accent"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                    )}
                                >
                                    <Icon
                                        className={cn(
                                            "size-5 shrink-0",
                                            isActive && "text-brand-accent",
                                        )}
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                    {!collapsed ? <span className="truncate">{item.label}</span> : null}
                                </Link>
                            );
                        })}
                    </div>
                );
            })}
        </nav>
    );
}

export function ShellB({ actor, activeTerm, children }: ShellBProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileOpen, setMobileOpen] = useState(false);

    const collapsed = useSyncExternalStore(
        subscribeSidebarStorage,
        getSidebarCollapsedSnapshot,
        () => false,
    );

    function toggleCollapsed() {
        try {
            const next = !collapsed;
            window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
            window.dispatchEvent(new Event("sycomp-sidebar-toggle"));
        } catch {
            // Ignore storage errors in private browsing
        }
    }

    async function handleSignOut() {
        try {
            await fetch(ROUTES.api.auth.logout, { method: "POST" });
        } catch {
            // Continue redirect on network hiccup
        }
        toast.success("Signed out.");
        router.push(ROUTES.auth.login);
        router.refresh();
    }

    const roleBadge = formatRoleBadge(actor.systemRole);

    return (
        <div className="flex min-h-screen bg-background text-foreground">
            <aside
                aria-label="Workspace sidebar"
                className={cn(
                    "hidden shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 lg:flex",
                    collapsed ? "w-16" : "w-[248px]",
                )}
            >
                <div
                    className={cn(
                        "flex h-14 items-center border-b border-border px-4",
                        collapsed && "justify-center px-0",
                    )}
                >
                    <Link
                        href={ROUTES.workspace.dashboard}
                        className="flex items-center gap-2.5 font-semibold tracking-tight"
                    >
                        <BrandMark />
                        {!collapsed ? <span>SYComP OMS</span> : null}
                    </Link>
                </div>
                <div className="flex-1 overflow-y-auto px-3 py-4">
                    <SidebarNavList
                        role={actor.systemRole}
                        pathname={pathname}
                        collapsed={collapsed}
                    />
                </div>
                <div className="border-t border-border p-3">
                    <div
                        className={cn(
                            "flex items-center gap-2.5 rounded-md px-2 py-1.5",
                            collapsed && "justify-center px-0",
                        )}
                    >
                        <UserCircle
                            className="size-5 shrink-0 text-muted-foreground"
                            strokeWidth={1.75}
                            aria-hidden="true"
                        />
                        {!collapsed ? (
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium">{actor.fullName}</p>
                                <p className="truncate font-mono text-xs text-muted-foreground">
                                    {actor.studentIdNumber}
                                </p>
                            </div>
                        ) : null}
                    </div>
                </div>
            </aside>

            <Sheet open={mobileOpen} onOpenChange={setMobileOpen} title="SYComP OMS">
                <SidebarNavList
                    role={actor.systemRole}
                    pathname={pathname}
                    collapsed={false}
                    onNavigate={() => setMobileOpen(false)}
                />
            </Sheet>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-30 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
                    <div className="flex h-14 items-center justify-between gap-3 px-4">
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="lg:hidden"
                                aria-label="Open navigation menu"
                                onClick={() => setMobileOpen(true)}
                            >
                                <Menu className="size-5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="hidden lg:inline-flex"
                                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                                onClick={toggleCollapsed}
                            >
                                {collapsed ? (
                                    <PanelLeftOpen
                                        className="size-5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <PanelLeftClose
                                        className="size-5"
                                        strokeWidth={1.75}
                                        aria-hidden="true"
                                    />
                                )}
                            </Button>
                            <span className="text-sm font-medium text-muted-foreground">
                                {pathname === ROUTES.workspace.account ? "Account Security" : "Workspace"}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            {activeTerm ? (
                                <Badge variant="neutral" className="hidden font-mono sm:inline-flex">
                                    {activeTerm.code}
                                </Badge>
                            ) : null}
                            <Badge variant={roleBadge.variant}>{roleBadge.label}</Badge>
                            <ThemeToggle />
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Sign out"
                                title="Sign out"
                                onClick={handleSignOut}
                            >
                                <LogOut className="size-5" strokeWidth={1.75} aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                </header>

                <SecurityOnboardingBanner actor={actor} accountHref={ROUTES.workspace.account} />

                <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

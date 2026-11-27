"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
    Calendar,
    ClipboardCheck,
    Home,
    LogOut,
    Megaphone,
    UserCircle,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import type { SessionActorDto } from "@/lib/auth/dto";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandMark } from "./brand-mark";
import { SecurityOnboardingBanner } from "./security-onboarding-banner";

const PORTAL_TABS = [
    { label: "Home", href: ROUTES.portal.home, icon: Home, exact: true },
    { label: "Calendar", href: ROUTES.portal.calendar, icon: Calendar, exact: false },
    { label: "Attendance", href: ROUTES.portal.attendance, icon: ClipboardCheck, exact: false },
    { label: "Notices", href: ROUTES.portal.announcements, icon: Megaphone, exact: false },
    { label: "Account", href: ROUTES.portal.account, icon: UserCircle, exact: false },
] as const;

interface ShellAProps {
    actor: SessionActorDto;
    children: ReactNode;
}

export function ShellA({ actor, children }: ShellAProps) {
    const pathname = usePathname();
    const router = useRouter();

    async function handleSignOut() {
        try {
            await fetch(ROUTES.api.auth.logout, { method: "POST" });
        } catch {
            // Still redirect on network hiccup
        }
        toast.success("Signed out.");
        router.push(ROUTES.auth.login);
        router.refresh();
    }

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <header className="sticky top-0 z-30 border-b border-border bg-card pt-[env(safe-area-inset-top)]">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
                    <Link
                        href={ROUTES.portal.home}
                        className="flex items-center gap-2.5 font-semibold tracking-tight"
                    >
                        <BrandMark />
                        <span>SYComP</span>
                    </Link>

                    <nav aria-label="Member portal navigation" className="hidden items-center gap-1 md:flex">
                        {PORTAL_TABS.map((item) => {
                            const Icon = item.icon;
                            const isActive = item.exact
                                ? pathname === item.href
                                : pathname === item.href || pathname.startsWith(`${item.href}/`);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    aria-current={isActive ? "page" : undefined}
                                    className={cn(
                                        "inline-flex min-h-10 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                                        isActive
                                            ? "bg-brand-soft text-primary dark:text-brand-accent"
                                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                                    )}
                                >
                                    <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="flex items-center gap-1.5">
                        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                            {actor.studentIdNumber}
                        </span>
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

            <SecurityOnboardingBanner actor={actor} accountHref={ROUTES.portal.account} />

            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 pb-24 md:pb-8">
                {children}
            </main>

            <nav
                aria-label="Mobile portal tabs"
                className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
            >
                <div className="grid grid-cols-5">
                    {PORTAL_TABS.map((item) => {
                        const Icon = item.icon;
                        const isActive = item.exact
                            ? pathname === item.href
                            : pathname === item.href || pathname.startsWith(`${item.href}/`);
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={isActive ? "page" : undefined}
                                className={cn(
                                    "flex min-h-12 min-w-11 flex-col items-center justify-center gap-1 px-1 py-1.5 text-xs font-medium transition-colors",
                                    isActive
                                        ? "bg-brand-soft/60 text-primary dark:text-brand-accent"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
                                <span>{item.label}</span>
                            </Link>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}

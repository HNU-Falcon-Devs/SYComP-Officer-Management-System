import type { ReactNode } from "react";
import Link from "next/link";
import { ROUTES } from "@/config/routes";
import { BrandMark } from "@/components/shells/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <header className="border-b border-border bg-card pt-[env(safe-area-inset-top)]">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
                    <Link
                        href={ROUTES.auth.login}
                        className="flex items-center gap-2.5 font-semibold tracking-tight"
                    >
                        <BrandMark />
                        <span>SYComP OMS</span>
                    </Link>
                    <ThemeToggle />
                </div>
            </header>
            <main className="flex flex-1 items-center justify-center px-4 py-8">
                {children}
            </main>
        </div>
    );
}

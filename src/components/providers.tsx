"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

function subscribeOnlineStatus(callback: () => void) {
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
    };
}

function getOnlineSnapshot() {
    return navigator.onLine;
}

function getServerSnapshot() {
    return true;
}

function OfflineBanner() {
    const isOnline = useSyncExternalStore(
        subscribeOnlineStatus,
        getOnlineSnapshot,
        getServerSnapshot,
    );

    if (isOnline) {
        return null;
    }

    return (
        <div
            role="status"
            aria-live="polite"
            className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs font-medium text-warning"
        >
            <div className="mx-auto flex max-w-6xl items-center justify-center gap-2">
                <WifiOff className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span>
                    You are offline. Live updates and attendance scanning require an internet
                    connection.
                </span>
            </div>
        </div>
    );
}

export function Providers({ children }: { children: ReactNode }) {
    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            <OfflineBanner />
            {children}
            <Toaster
                position="top-right"
                toastOptions={{
                    className: "border border-border bg-card text-foreground",
                    style: { boxShadow: "var(--shadow-overlay-sm)" },
                }}
            />
        </ThemeProvider>
    );
}

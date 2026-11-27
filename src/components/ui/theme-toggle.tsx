"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "./button";

const THEME_ORDER = ["system", "light", "dark"] as const;

function subscribeNoop() {
    return () => {};
}

export function ThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const mounted = useSyncExternalStore(
        subscribeNoop,
        () => true,
        () => false,
    );

    const current = mounted ? (theme ?? "system") : "system";
    const nextIndex = (THEME_ORDER.indexOf(current as (typeof THEME_ORDER)[number]) + 1) % THEME_ORDER.length;
    const nextTheme = THEME_ORDER[nextIndex] ?? "light";

    const label = !mounted
        ? "Toggle color theme"
        : `Theme: ${current} (${resolvedTheme ?? "auto"}). Switch to ${nextTheme}`;

    return (
        <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            onClick={() => setTheme(nextTheme)}
        >
            {!mounted || current === "system" ? (
                <Monitor className="size-5" strokeWidth={1.75} aria-hidden="true" />
            ) : current === "dark" ? (
                <Moon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            ) : (
                <Sun className="size-5" strokeWidth={1.75} aria-hidden="true" />
            )}
        </Button>
    );
}

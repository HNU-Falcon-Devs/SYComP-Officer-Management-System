"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./button";

interface SheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    children: ReactNode;
}

export function Sheet({ open, onOpenChange, title, children }: SheetProps) {
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onOpenChange(false);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onOpenChange]);

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
            <button
                type="button"
                aria-label="Close navigation drawer"
                className="fixed inset-0 bg-foreground/25"
                onClick={() => onOpenChange(false)}
            />
            <div
                className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card"
                style={{ boxShadow: "var(--shadow-overlay-md)" }}
            >
                <div className="flex h-14 items-center justify-between border-b border-border px-4">
                    <span className="text-sm font-semibold tracking-tight">{title}</span>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Close navigation menu"
                        onClick={() => onOpenChange(false)}
                    >
                        <X className="size-5" strokeWidth={1.75} aria-hidden="true" />
                    </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-3">{children}</div>
            </div>
        </div>
    );
}

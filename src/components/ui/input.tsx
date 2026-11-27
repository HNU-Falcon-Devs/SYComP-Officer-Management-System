import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = "text", ...props }: InputProps) {
    return (
        <input
            type={type}
            className={cn(
                "flex min-h-11 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:border-primary focus-visible:bg-card focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-accent disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive sm:min-h-10",
                className,
            )}
            {...props}
        />
    );
}

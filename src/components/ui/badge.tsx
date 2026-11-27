import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none whitespace-nowrap",
    {
        variants: {
            variant: {
                neutral: "border-border bg-muted text-muted-foreground",
                brand: "border-brand-accent/25 bg-brand-soft text-primary dark:text-brand-accent",
                success: "border-success/25 bg-success/10 text-success",
                warning: "border-warning/25 bg-warning/10 text-warning",
                destructive: "border-destructive/25 bg-destructive/10 text-destructive",
                info: "border-info/25 bg-info/10 text-info",
            },
        },
        defaultVariants: {
            variant: "neutral",
        },
    },
);

export interface BadgeProps
    extends HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
    return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

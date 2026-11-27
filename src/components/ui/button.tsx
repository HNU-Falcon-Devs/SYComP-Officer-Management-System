import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                primary:
                    "border border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                secondary:
                    "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "border border-transparent bg-transparent text-foreground hover:bg-muted",
                destructive:
                    "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
            },
            size: {
                default: "min-h-11 px-4 py-2 sm:min-h-10",
                sm: "min-h-11 px-3 text-xs sm:min-h-9",
                icon: "size-11 sm:size-10",
            },
        },
        defaultVariants: {
            variant: "primary",
            size: "default",
        },
    },
);

export interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
    return (
        <button
            type={type}
            className={cn(buttonVariants({ variant, size }), className)}
            {...props}
        />
    );
}

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            className={cn("size-7 shrink-0 text-primary", className)}
        >
            <path
                d="M14 2.5L24 8.25V19.75L14 25.5L4 19.75V8.25L14 2.5Z"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinejoin="round"
            />
            <path
                d="M9.5 11.25L14 8.75L18.5 11.25V14L14 16.5L9.5 14V11.25Z"
                fill="currentColor"
            />
            <path
                d="M9.5 16.75L14 19.25L18.5 16.75"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

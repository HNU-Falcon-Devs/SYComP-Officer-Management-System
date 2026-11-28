"use client";

import { Fragment, useRef, useState, type ReactNode } from "react";
import {
    Bold,
    Eye,
    Heading2,
    Heading3,
    Italic,
    Link2,
    List,
    ListOrdered,
    Pencil,
    Quote,
    Redo2,
    Underline,
    Undo2,
} from "lucide-react";

export interface RichTextEditorProps {
    id: string;
    label: string;
    value: string;
    onChange: (html: string) => void;
    disabled?: boolean;
    placeholder?: string;
    rows?: number;
}

const SAFE_TAGS = new Set([
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "a",
    "hr",
]);

const SKIP_CONTENT_TAGS = new Set(["script", "style", "iframe", "object", "embed", "svg"]);
const VOID_TAGS = new Set(["br", "hr"]);

function decodeEntities(text: string): string {
    return text
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, "&");
}

function extractSafeHref(attrString: string): string | null {
    const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrString);
    const raw = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
    if (!raw) return null;
    try {
        const parsed = new URL(decodeEntities(raw));
        if (parsed.protocol === "https:" || parsed.protocol === "mailto:") {
            return parsed.toString();
        }
    } catch {
        return null;
    }
    return null;
}

interface ParsedNode {
    tag: string | null;
    href?: string;
    text?: string;
    children: ParsedNode[];
}

function parseAllowlistedHtml(html: string): ParsedNode[] {
    const root: ParsedNode = { tag: null, children: [] };
    const stack: ParsedNode[] = [root];
    const tokenRe = /<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;

    let skipDepth = 0;
    let skipTagName: string | null = null;
    let match: RegExpExecArray | null;

    while ((match = tokenRe.exec(html)) !== null) {
        if (match[3] !== undefined) {
            if (skipDepth === 0) {
                const text = decodeEntities(match[3]);
                if (text) {
                    stack[stack.length - 1].children.push({
                        tag: null,
                        text,
                        children: [],
                    });
                }
            }
            continue;
        }

        const rawFull = match[0];
        const tag = match[1].toLowerCase();
        const attrs = match[2] ?? "";
        const isClosing = rawFull.startsWith("</");
        const isSelfClosing = rawFull.endsWith("/>") || VOID_TAGS.has(tag);

        if (SKIP_CONTENT_TAGS.has(tag)) {
            if (isClosing && skipTagName === tag && skipDepth > 0) {
                skipDepth -= 1;
                if (skipDepth === 0) skipTagName = null;
            } else if (!isClosing && !isSelfClosing) {
                if (skipDepth === 0) skipTagName = tag;
                if (skipTagName === tag) skipDepth += 1;
            }
            continue;
        }

        if (skipDepth > 0 || !SAFE_TAGS.has(tag)) {
            continue;
        }

        if (isClosing) {
            for (let i = stack.length - 1; i >= 1; i -= 1) {
                if (stack[i].tag === tag) {
                    stack.length = i;
                    break;
                }
            }
            continue;
        }

        const node: ParsedNode = {
            tag,
            href: tag === "a" ? (extractSafeHref(attrs) ?? undefined) : undefined,
            children: [],
        };
        stack[stack.length - 1].children.push(node);
        if (!isSelfClosing) {
            stack.push(node);
        }
    }

    return root.children;
}

function renderParsedNodes(nodes: ParsedNode[], keyPrefix: string): ReactNode[] {
    return nodes.map((node, index) => {
        const key = `${keyPrefix}-${index}`;
        if (node.tag === null) {
            return <Fragment key={key}>{node.text}</Fragment>;
        }
        const children = renderParsedNodes(node.children, key);

        switch (node.tag) {
            case "br":
                return <br key={key} />;
            case "hr":
                return <hr key={key} className="my-3 border-border" />;
            case "h1":
            case "h2":
                return (
                    <h3 key={key} className="mt-3 mb-1.5 text-base font-semibold text-foreground">
                        {children}
                    </h3>
                );
            case "h3":
            case "h4":
                return (
                    <h4 key={key} className="mt-2.5 mb-1 text-sm font-semibold text-foreground">
                        {children}
                    </h4>
                );
            case "p":
                return (
                    <p key={key} className="my-1.5 text-sm leading-relaxed text-foreground">
                        {children}
                    </p>
                );
            case "strong":
            case "b":
                return (
                    <strong key={key} className="font-semibold">
                        {children}
                    </strong>
                );
            case "em":
            case "i":
                return (
                    <em key={key} className="italic">
                        {children}
                    </em>
                );
            case "u":
                return (
                    <u key={key} className="underline">
                        {children}
                    </u>
                );
            case "s":
                return (
                    <s key={key} className="line-through">
                        {children}
                    </s>
                );
            case "ul":
                return (
                    <ul key={key} className="my-2 list-disc space-y-1 pl-5 text-sm text-foreground">
                        {children}
                    </ul>
                );
            case "ol":
                return (
                    <ol
                        key={key}
                        className="my-2 list-decimal space-y-1 pl-5 text-sm text-foreground"
                    >
                        {children}
                    </ol>
                );
            case "li":
                return <li key={key}>{children}</li>;
            case "blockquote":
                return (
                    <blockquote
                        key={key}
                        className="my-2 border-l-2 border-border pl-3 text-sm text-muted-foreground"
                    >
                        {children}
                    </blockquote>
                );
            case "code":
                return (
                    <code
                        key={key}
                        className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
                    >
                        {children}
                    </code>
                );
            case "pre":
                return (
                    <pre
                        key={key}
                        className="my-2 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground"
                    >
                        {children}
                    </pre>
                );
            case "a":
                if (!node.href) {
                    return <Fragment key={key}>{children}</Fragment>;
                }
                return (
                    <a
                        key={key}
                        href={node.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary underline underline-offset-2 hover:opacity-80 dark:text-brand-accent"
                    >
                        {children}
                    </a>
                );
            default:
                return <Fragment key={key}>{children}</Fragment>;
        }
    });
}

export function SafeHtmlDisplay({
    html,
    emptyLabel,
}: {
    html: string | null | undefined;
    emptyLabel: string;
}) {
    if (!html || !html.trim()) {
        return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
    }
    const nodes = parseAllowlistedHtml(html);
    if (nodes.length === 0) {
        return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
    }
    return <div className="max-w-[72ch] break-words">{renderParsedNodes(nodes, "rt")}</div>;
}

export function RichTextEditor({
    id,
    label,
    value,
    onChange,
    disabled = false,
    placeholder = "Write event objectives, program flow, and resource notes...",
    rows = 8,
}: RichTextEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [tab, setTab] = useState<"write" | "preview">("write");
    const [undoStack, setUndoStack] = useState<string[]>([]);
    const [redoStack, setRedoStack] = useState<string[]>([]);

    function commitChange(next: string) {
        setUndoStack((prev) => [...prev.slice(-24), value]);
        setRedoStack([]);
        onChange(next);
    }

    function handleUndo() {
        if (disabled || undoStack.length === 0) return;
        const previous = undoStack[undoStack.length - 1];
        setUndoStack((prev) => prev.slice(0, -1));
        setRedoStack((prev) => [...prev.slice(-24), value]);
        onChange(previous);
    }

    function handleRedo() {
        if (disabled || redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        setRedoStack((prev) => prev.slice(0, -1));
        setUndoStack((prev) => [...prev.slice(-24), value]);
        onChange(next);
    }

    function insertWrap(prefix: string, suffix: string, fallbackText: string) {
        if (disabled) return;
        const el = textareaRef.current;
        if (!el) {
            commitChange(`${value}${prefix}${fallbackText}${suffix}`);
            return;
        }
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        const selected = value.slice(start, end) || fallbackText;
        const next = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
        commitChange(next);
        requestAnimationFrame(() => {
            el.focus();
            const cursorStart = start + prefix.length;
            el.setSelectionRange(cursorStart, cursorStart + selected.length);
        });
    }

    function insertLink() {
        if (disabled) return;
        const href = window.prompt("Enter HTTPS URL:", "https://");
        if (!href) return;
        const trimmed = href.trim();
        if (!trimmed.startsWith("https://") && !trimmed.startsWith("mailto:")) {
            return;
        }
        insertWrap(`<a href="${trimmed}">`, "</a>", "Reference link");
    }

    const toolbarBtnClass =
        "inline-flex size-11 items-center justify-center rounded text-muted-foreground hover:bg-card hover:text-foreground disabled:opacity-40 sm:size-8";

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor={id} className="text-xs font-medium">
                    {label}
                </label>
                <div className="inline-flex rounded-md border border-border bg-muted p-0.5 text-xs">
                    <button
                        type="button"
                        onClick={() => setTab("write")}
                        className={`inline-flex min-h-11 items-center gap-1 rounded px-2.5 font-medium sm:min-h-8 ${
                            tab === "write"
                                ? "bg-card text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Pencil className="size-3" strokeWidth={1.75} aria-hidden="true" />
                        <span>Write</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab("preview")}
                        className={`inline-flex min-h-11 items-center gap-1 rounded px-2.5 font-medium sm:min-h-8 ${
                            tab === "preview"
                                ? "bg-card text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        <Eye className="size-3" strokeWidth={1.75} aria-hidden="true" />
                        <span>Preview</span>
                    </button>
                </div>
            </div>

            {tab === "write" ? (
                <div className="overflow-hidden rounded-md border border-border bg-card">
                    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/60 px-2 py-1.5">
                        <button
                            type="button"
                            disabled={disabled}
                            title="Heading 2"
                            aria-label="Insert heading 2"
                            onClick={() => insertWrap("<h2>", "</h2>\n", "Section Heading")}
                            className={toolbarBtnClass}
                        >
                            <Heading2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Heading 3"
                            aria-label="Insert heading 3"
                            onClick={() => insertWrap("<h3>", "</h3>\n", "Subheading")}
                            className={toolbarBtnClass}
                        >
                            <Heading3 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Bold"
                            aria-label="Bold text"
                            onClick={() => insertWrap("<strong>", "</strong>", "bold text")}
                            className={toolbarBtnClass}
                        >
                            <Bold className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Italic"
                            aria-label="Italic text"
                            onClick={() => insertWrap("<em>", "</em>", "italic text")}
                            className={toolbarBtnClass}
                        >
                            <Italic className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Underline"
                            aria-label="Underline text"
                            onClick={() => insertWrap("<u>", "</u>", "underlined text")}
                            className={toolbarBtnClass}
                        >
                            <Underline className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Bulleted list"
                            aria-label="Insert bulleted list"
                            onClick={() =>
                                insertWrap("<ul>\n  <li>", "</li>\n</ul>\n", "Key objective")
                            }
                            className={toolbarBtnClass}
                        >
                            <List className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Numbered list"
                            aria-label="Insert numbered list"
                            onClick={() =>
                                insertWrap("<ol>\n  <li>", "</li>\n</ol>\n", "Program step")
                            }
                            className={toolbarBtnClass}
                        >
                            <ListOrdered className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Blockquote"
                            aria-label="Insert quote"
                            onClick={() =>
                                insertWrap("<blockquote>", "</blockquote>\n", "Note / Rationale")
                            }
                            className={toolbarBtnClass}
                        >
                            <Quote className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled}
                            title="Insert HTTPS link"
                            aria-label="Insert link"
                            onClick={insertLink}
                            className={toolbarBtnClass}
                        >
                            <Link2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                        <button
                            type="button"
                            disabled={disabled || undoStack.length === 0}
                            title="Undo"
                            aria-label="Undo edit"
                            onClick={handleUndo}
                            className={toolbarBtnClass}
                        >
                            <Undo2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            disabled={disabled || redoStack.length === 0}
                            title="Redo"
                            aria-label="Redo edit"
                            onClick={handleRedo}
                            className={toolbarBtnClass}
                        >
                            <Redo2 className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        </button>
                    </div>
                    <textarea
                        ref={textareaRef}
                        id={id}
                        rows={rows}
                        disabled={disabled}
                        value={value}
                        onChange={(e) => commitChange(e.target.value)}
                        placeholder={placeholder}
                        className="w-full resize-y bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                </div>
            ) : (
                <div className="min-h-44 rounded-md border border-border bg-muted/30 p-3.5">
                    <SafeHtmlDisplay html={value} emptyLabel="Nothing to preview yet." />
                </div>
            )}
            <p className="text-xs text-muted-foreground">
                Rich-text HTML is sanitized server-side against the SYComP allowlist before storage.
            </p>
        </div>
    );
}

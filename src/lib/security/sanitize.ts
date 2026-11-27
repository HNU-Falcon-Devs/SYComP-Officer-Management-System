import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
    "p",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "strong",
    "em",
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
];

export function sanitizeRichText(html: string): string {
    return sanitizeHtml(html, {
        allowedTags: ALLOWED_TAGS,
        allowedAttributes: {
            a: ["href", "target", "rel"],
        },
        allowedSchemes: ["https", "mailto"],
        allowedSchemesAppliedToAttributes: ["href"],
        allowProtocolRelative: false,
        disallowedTagsMode: "discard",
        transformTags: {
            a: (_tagName, attribs) => ({
                tagName: "a",
                attribs: {
                    ...attribs,
                    rel: "noopener noreferrer",
                    ...(attribs.target === "_blank" ? { target: "_blank" } : {}),
                },
            }),
        },
    });
}

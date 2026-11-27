import { describe, expect, it, vi } from "vitest";
import {
    buildSafeDrivePreviewUrl,
    resolveDriveFolderPath,
    sanitizeDriveSegment,
    sanitizeUploadFilename,
    validateExternalDriveUrl,
    validateUploadFileDescriptor,
    verifyFileMagicBytes,
} from "./classifier";
import { signUploadIntentToken, verifyUploadIntentToken } from "./client";
import { GoogleDriveProvider } from "./google.provider";
import { buildDrivePermissionPayload } from "./permissions";

describe("Google Drive classifier, validation, intent tokens, and provider", () => {
    it("routes proposal attachments, event-linked docs, and unlinked general docs (BR-DOC-02)", () => {
        const proposalPath = resolveDriveFolderPath({
            academicTermName: "AY 2026-2027 - 1st Sem",
            academicTermCode: "AY2026-2027-S1",
            documentTypeSegment: "Communication Letters",
            documentTypeSlug: "communication-letters",
            eventTitle: "Tech Innovation Summit 2026",
            eventSlug: "tech-innovation-summit-2026",
            isProposal: true,
        });
        expect(proposalPath.segments).toEqual([
            "AY 2026-2027 - 1st Sem",
            "Proposals",
            "Tech Innovation Summit 2026",
        ]);
        expect(proposalPath.pathKey).toBe("ay2026-2027-s1/proposals/tech-innovation-summit-2026");

        const eventPath = resolveDriveFolderPath({
            academicTermName: "AY 2026-2027 - 1st Sem",
            academicTermCode: "AY2026-2027-S1",
            documentTypeSegment: "Communication Letters",
            documentTypeSlug: "communication-letters",
            eventTitle: "Tech Innovation Summit 2026",
            eventSlug: "tech-innovation-summit-2026",
            isProposal: false,
        });
        expect(eventPath.segments).toEqual([
            "AY 2026-2027 - 1st Sem",
            "Communication Letters",
            "Tech Innovation Summit 2026",
        ]);
        expect(eventPath.pathKey).toBe(
            "ay2026-2027-s1/communication-letters/tech-innovation-summit-2026",
        );

        const generalPath = resolveDriveFolderPath({
            academicTermName: "AY 2026-2027 - 1st Sem",
            academicTermCode: "AY2026-2027-S1",
            documentTypeSegment: "Minutes",
            documentTypeSlug: "minutes",
        });
        expect(generalPath.segments).toEqual(["AY 2026-2027 - 1st Sem", "Minutes", "General"]);
        expect(generalPath.pathKey).toBe("ay2026-2027-s1/minutes/general");
    });

    it("strips path traversal, separators, and control characters from segments and filenames", () => {
        expect(sanitizeDriveSegment("../../etc/passwd\x00")).not.toContain("..");
        expect(sanitizeDriveSegment("../../etc/passwd\x00")).not.toContain("/");
        expect(sanitizeDriveSegment("...   ")).toBe("Untitled");
        expect(sanitizeUploadFilename("C:\\fakepath\\../../letter..pdf\n")).toBe("letter.pdf");
    });

    it("enforces file extension, MIME allowlist, size limits, and double-extension attacks", () => {
        expect(
            validateUploadFileDescriptor({
                filename: "letter.pdf",
                mimeType: "application/pdf",
                fileSizeBytes: 1024,
                maxUploadSizeBytes: 15_728_640,
            }),
        ).toEqual({
            ok: true,
            sanitizedFilename: "letter.pdf",
            extension: ".pdf",
            canonicalMimeType: "application/pdf",
        });

        const oversize = validateUploadFileDescriptor({
            filename: "large.pdf",
            mimeType: "application/pdf",
            fileSizeBytes: 15_728_641,
            maxUploadSizeBytes: 15_728_640,
        });
        expect(oversize.ok).toBe(false);
        if (!oversize.ok) {
            expect(oversize.status).toBe(413);
            expect(oversize.code).toBe("FILE_TOO_LARGE");
        }

        for (const bad of [
            { filename: "payload.exe", mimeType: "application/x-msdownload" },
            { filename: "report.pdf.exe", mimeType: "application/pdf" },
            { filename: "xss.html", mimeType: "text/html" },
            { filename: "vector.svg", mimeType: "image/svg+xml" },
            { filename: "script.js", mimeType: "application/javascript" },
            { filename: "spoof.pdf", mimeType: "image/png" },
        ]) {
            const res = validateUploadFileDescriptor({
                ...bad,
                fileSizeBytes: 500,
                maxUploadSizeBytes: 15_728_640,
            });
            expect(res.ok).toBe(false);
        }
    });

    it("verifies file magic bytes and rejects spoofed headers", () => {
        expect(verifyFileMagicBytes(".pdf", Buffer.from("%PDF-1.7\n..."))).toBe(true);
        expect(verifyFileMagicBytes(".pdf", Buffer.from("MZ\x90\x00exe"))).toBe(false);

        expect(
            verifyFileMagicBytes(
                ".png",
                new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
            ),
        ).toBe(true);
        expect(verifyFileMagicBytes(".jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
        expect(verifyFileMagicBytes(".docx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(
            true,
        );
        expect(verifyFileMagicBytes(".xlsx", Buffer.from("not-a-zip"))).toBe(false);

        expect(verifyFileMagicBytes(".csv", Buffer.from("id,name\n2024-001,Ana"))).toBe(true);
        expect(verifyFileMagicBytes(".txt", Buffer.from("<script>alert(1)</script>"))).toBe(false);
        expect(verifyFileMagicBytes(".txt", Buffer.from("MZ\x90\x00"))).toBe(false);
        expect(verifyFileMagicBytes(".txt", new Uint8Array([0x41, 0x00, 0x42]))).toBe(false);
    });

    it("validates external Google Drive URLs strictly and builds safe preview URLs", () => {
        expect(
            validateExternalDriveUrl("https://docs.google.com/document/d/1234567890/edit").ok,
        ).toBe(true);
        expect(validateExternalDriveUrl("https://drive.google.com/file/d/abcDEF12345/view").ok).toBe(
            true,
        );
        expect(validateExternalDriveUrl("http://drive.google.com/file/d/abc/view").ok).toBe(false);
        expect(validateExternalDriveUrl("https://drive.google.com.evil.com/file/d/abc").ok).toBe(
            false,
        );
        expect(validateExternalDriveUrl("https://user:pass@drive.google.com/file/d/abc").ok).toBe(
            false,
        );
        expect(validateExternalDriveUrl("javascript:alert(1)").ok).toBe(false);

        expect(
            buildSafeDrivePreviewUrl({
                driveFileId: "1AbCdEfGhIjKlMnOpQr",
                webViewLink: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view",
                storageMode: "DRIVE_UPLOAD",
            }),
        ).toBe("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/preview");

        expect(
            buildSafeDrivePreviewUrl({
                driveFileId: "mock-file-12345678",
                webViewLink: "https://drive.google.com/file/d/mock-file-12345678/view",
                storageMode: "DRIVE_UPLOAD",
            }),
        ).toBeNull();
    });

    it("signs and verifies HMAC upload intent tokens and detects tampering/expiry", () => {
        const secret = "test-upload-intent-secret-at-least-32-chars";
        const now = 1_700_000_000_000;
        const token = signUploadIntentToken(
            {
                actorId: "actor-1",
                academicTermId: "term-1",
                documentTypeId: "type-1",
                eventId: null,
                meetingId: null,
                isProposalAttachment: false,
                title: "Test Document",
                initialStatus: "DRAFT",
                driveFolderCacheId: "cache-1",
                parentDriveFolderId: "folder-1",
                expectedFilename: "doc.pdf",
                expectedExtension: ".pdf",
                expectedMimeType: "application/pdf",
            },
            secret,
            now,
        );

        const valid = verifyUploadIntentToken(token, secret, now + 60_000);
        expect(valid.ok).toBe(true);
        if (valid.ok) {
            expect(valid.payload.actorId).toBe("actor-1");
            expect(valid.payload.parentDriveFolderId).toBe("folder-1");
        }

        expect(verifyUploadIntentToken(`${token}x`, secret, now + 1000).ok).toBe(false);
        expect(verifyUploadIntentToken(token, "wrong-secret-0000000000000000000000", now).ok).toBe(
            false,
        );
        expect(verifyUploadIntentToken(token, secret, now + 16 * 60 * 1000).ok).toBe(false);
    });

    it("builds domain and unlisted permission payloads", () => {
        expect(
            buildDrivePermissionPayload({
                shareMode: "domain",
                universityEmailDomain: "HNU.EDU.PH",
            }),
        ).toEqual({
            type: "domain",
            domain: "hnu.edu.ph",
            role: "reader",
            allowFileDiscovery: false,
        });

        expect(
            buildDrivePermissionPayload({
                shareMode: "unlisted",
                universityEmailDomain: "hnu.edu.ph",
            }),
        ).toEqual({
            type: "anyone",
            role: "reader",
            allowFileDiscovery: false,
        });
    });

    it("executes GoogleDriveProvider OAuth2 refresh, resumable init, range check, and permissions via fetch", async () => {
        const calls: Array<{ url: string; method: string; headers?: Record<string, string> }> = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? "GET";
            const headersObj = Object.fromEntries(new Headers(init?.headers).entries());
            calls.push({ url, method, headers: headersObj });

            if (url.startsWith("https://oauth2.googleapis.com/token")) {
                return new Response(
                    JSON.stringify({ access_token: "ya29.test-token", expires_in: 3600 }),
                    { status: 200 },
                );
            }
            if (url.includes("/upload/drive/v3/files?uploadType=resumable")) {
                return new Response(null, {
                    status: 200,
                    headers: { Location: "https://www.googleapis.com/upload/session-xyz" },
                });
            }
            if (url.includes("/drive/v3/files/file-abc?alt=media")) {
                return new Response(Buffer.from("%PDF-1.7"), { status: 206 });
            }
            if (url.includes("/drive/v3/files/file-abc/permissions")) {
                return new Response(JSON.stringify({ id: "perm-1" }), { status: 200 });
            }
            return new Response(JSON.stringify({ files: [{ id: "folder-123" }] }), { status: 200 });
        }) as unknown as typeof fetch;

        const provider = new GoogleDriveProvider({
            clientId: "cid",
            clientSecret: "csec",
            refreshToken: "rtok",
            rootFolderId: "root-1",
            fetchFn: fetchMock,
        });

        const folder = await provider.findOrCreateFolder("O'Brien Docs", "root-1");
        expect(folder).toEqual({ folderId: "folder-123", created: false });

        const resumable = await provider.createResumableUploadSession({
            actorId: "u1",
            parentFolderId: "folder-123",
            filename: "letter.pdf",
            mimeType: "application/pdf",
            fileSizeBytes: 2048,
            maxUploadSizeBytes: 15_728_640,
            origin: "https://oms.sycomp.org",
        });
        expect(resumable.uploadUrl).toBe("https://www.googleapis.com/upload/session-xyz");

        const headerBytes = await provider.readFileHeaderBytes("file-abc", 8);
        expect(Buffer.from(headerBytes!).toString("utf8")).toBe("%PDF-1.7");

        await provider.setFilePermission("file-abc", {
            type: "domain",
            domain: "hnu.edu.ph",
            role: "reader",
            allowFileDiscovery: false,
        });

        // OAuth token endpoint should only have been called once due to in-memory token cache
        const oauthCalls = calls.filter((c) => c.url.includes("oauth2.googleapis.com"));
        expect(oauthCalls).toHaveLength(1);
        const initCall = calls.find((c) => c.url.includes("uploadType=resumable"));
        expect(initCall?.headers?.origin).toBe("https://oms.sycomp.org");
    });
});

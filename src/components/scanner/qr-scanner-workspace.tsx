"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
    AlertCircle,
    Camera,
    CameraOff,
    Loader2,
    QrCode,
    RefreshCw,
    Search,
    WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import type { SystemRole } from "@/config/permissions";
import { ROUTES } from "@/config/routes";
import { formatManilaTimestamp } from "@/lib/admin/audit-logs";
import {
    STUDENT_ID_REGEX,
    type AttendanceRecordDto,
    type CheckpointDto,
    type LookupVerificationDto,
} from "@/lib/attendance/validation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { VerificationCard } from "./verification-card";

interface Html5QrcodeInstance {
    start: (
        cameraIdOrConfig: string | { facingMode: "environment" | "user" },
        configuration: { fps: number; qrbox?: { width: number; height: number } },
        qrCodeSuccessCallback: (decodedText: string) => void,
        qrCodeErrorCallback?: (errorMessage: string) => void,
    ) => Promise<null>;
    stop: () => Promise<void>;
    clear: () => void;
    pause: (pauseVideo?: boolean) => void;
    resume: () => void;
    getState?: () => number;
}

interface QrScannerWorkspaceProps {
    actorRole: SystemRole;
    initialCheckpoints: CheckpointDto[];
    initialSelectedCheckpointId: string | null;
    initialRecentScans: AttendanceRecordDto[];
}

function subscribeOnline(callback: () => void) {
    window.addEventListener("online", callback);
    window.addEventListener("offline", callback);
    return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
    };
}

function getOnlineSnapshot() {
    return typeof navigator === "undefined" ? true : navigator.onLine;
}

const READER_REGION_ID = "sycomp-qr-reader";

export function QrScannerWorkspace({
    actorRole,
    initialCheckpoints,
    initialSelectedCheckpointId,
    initialRecentScans,
}: QrScannerWorkspaceProps) {
    const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);

    const [checkpoints, setCheckpoints] = useState<CheckpointDto[]>(initialCheckpoints);
    const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>(
        initialSelectedCheckpointId ?? initialCheckpoints[0]?.id ?? "",
    );
    const [recentScans, setRecentScans] = useState<AttendanceRecordDto[]>(initialRecentScans);

    const [manualId, setManualId] = useState("");
    const [lookingUp, setLookingUp] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [verification, setVerification] = useState<LookupVerificationDto | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [cameraActive, setCameraActive] = useState(false);
    const [cameraStarting, setCameraStarting] = useState(false);
    const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
    const [cameraError, setCameraError] = useState<string | null>(null);

    const scannerRef = useRef<Html5QrcodeInstance | null>(null);
    const scanBusyRef = useRef(false);
    const cameraOpLockRef = useRef(false);
    const unmountedRef = useRef(false);

    const selectedCheckpoint = checkpoints.find((c) => c.id === selectedCheckpointId) ?? null;

    const stopCameraSafely = useCallback(async () => {
        const instance = scannerRef.current;
        scannerRef.current = null;
        if (!instance) {
            setCameraActive(false);
            return;
        }
        try {
            const state = instance.getState?.();
            // 2 = SCANNING, 3 = PAUSED in html5-qrcode
            if (state === undefined || state === 2 || state === 3) {
                await instance.stop().catch(() => undefined);
            }
        } finally {
            try {
                instance.clear();
            } catch {
                // Ignore DOM cleanup race under StrictMode unmount
            }
            if (!unmountedRef.current) {
                setCameraActive(false);
            }
        }
    }, []);

    useEffect(() => {
        unmountedRef.current = false;
        return () => {
            unmountedRef.current = true;
            void stopCameraSafely();
        };
    }, [stopCameraSafely]);

    const runLookup = useCallback(
        async (rawStudentId: string) => {
            if (!selectedCheckpointId) {
                setErrorMsg("Select an OPEN checkpoint first.");
                return false;
            }
            if (!isOnline) {
                setErrorMsg("You are offline. Live verification requires an internet connection.");
                return false;
            }

            const candidate = rawStudentId.trim();
            if (!STUDENT_ID_REGEX.test(candidate)) {
                setErrorMsg("QR payload or Student ID does not match institutional ID format.");
                return false;
            }

            setErrorMsg(null);
            setLookingUp(true);
            try {
                const params = new URLSearchParams({
                    checkpointId: selectedCheckpointId,
                    studentId: candidate,
                });
                const res = await fetch(`${ROUTES.api.attendance.lookup}?${params.toString()}`);
                const payload = (await res.json()) as {
                    data?: LookupVerificationDto;
                    error?: { message?: string };
                };
                if (!res.ok || !payload.data) {
                    setErrorMsg(payload.error?.message ?? "Failed to verify student ID.");
                    return false;
                }
                setVerification(payload.data);
                return true;
            } finally {
                setLookingUp(false);
            }
        },
        [isOnline, selectedCheckpointId],
    );

    const startCamera = useCallback(
        async (targetFacing: "environment" | "user") => {
            if (cameraOpLockRef.current || !selectedCheckpointId) {
                return;
            }
            cameraOpLockRef.current = true;
            setCameraStarting(true);
            setCameraError(null);

            try {
                await stopCameraSafely();
                const { Html5Qrcode } = await import("html5-qrcode");
                if (unmountedRef.current) {
                    return;
                }
                const instance = new Html5Qrcode(READER_REGION_ID) as unknown as Html5QrcodeInstance;
                scannerRef.current = instance;

                await instance.start(
                    { facingMode: targetFacing },
                    { fps: 10, qrbox: { width: 220, height: 220 } },
                    (decodedText) => {
                        // Synchronous lock prevents duplicate lookup bursts before pause() resolves
                        if (scanBusyRef.current) {
                            return;
                        }
                        scanBusyRef.current = true;
                        try {
                            instance.pause(true);
                        } catch {
                            // Ignore pause error if camera is stopping
                        }
                        void runLookup(decodedText).then((ok) => {
                            if (!ok && !unmountedRef.current) {
                                scanBusyRef.current = false;
                                try {
                                    instance.resume();
                                } catch {
                                    // Ignore resume error
                                }
                            }
                        });
                    },
                    () => {
                        // Ignore per-frame decode misses
                    },
                );

                if (unmountedRef.current) {
                    await stopCameraSafely();
                    return;
                }
                setCameraActive(true);
            } catch {
                await stopCameraSafely();
                if (!unmountedRef.current) {
                    setCameraError(
                        "Camera unavailable or permission denied. Use the manual Student ID input below.",
                    );
                }
            } finally {
                cameraOpLockRef.current = false;
                if (!unmountedRef.current) {
                    setCameraStarting(false);
                }
            }
        },
        [runLookup, selectedCheckpointId, stopCameraSafely],
    );

    function resumeCameraIfPaused() {
        scanBusyRef.current = false;
        const instance = scannerRef.current;
        if (!instance) return;
        try {
            if (instance.getState?.() === 3) {
                instance.resume();
            }
        } catch {
            // Ignore resume error when camera stopped
        }
    }

    async function handleCheckpointChange(nextCheckpointId: string) {
        setSelectedCheckpointId(nextCheckpointId);
        setVerification(null);
        setErrorMsg(null);
        resumeCameraIfPaused();
        if (!nextCheckpointId) {
            setRecentScans([]);
            return;
        }
        const params = new URLSearchParams({
            checkpointId: nextCheckpointId,
            limit: "10",
            page: "1",
        });
        const res = await fetch(`${ROUTES.api.attendance.records}?${params.toString()}`);
        if (res.ok) {
            const payload = (await res.json()) as { data?: { items: AttendanceRecordDto[] } };
            if (payload.data) {
                setRecentScans(payload.data.items);
            }
        }
    }

    async function handleRefreshCheckpoints() {
        const res = await fetch(`${ROUTES.api.attendance.checkpoints}?forScanner=true`);
        if (!res.ok) return;
        const payload = (await res.json()) as { data?: { checkpoints: CheckpointDto[] } };
        if (!payload.data) return;
        const nextList = payload.data.checkpoints;
        setCheckpoints(nextList);
        if (!nextList.some((c) => c.id === selectedCheckpointId)) {
            await handleCheckpointChange(nextList[0]?.id ?? "");
        }
    }

    async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!manualId.trim()) return;
        scanBusyRef.current = true;
        try {
            scannerRef.current?.pause(true);
        } catch {
            // Ignore if camera is not running
        }
        const ok = await runLookup(manualId);
        if (!ok) {
            resumeCameraIfPaused();
        }
    }

    async function handleConfirm(breakGlassReason?: string) {
        if (!verification?.target || !selectedCheckpointId) return;
        if (!isOnline) {
            setErrorMsg("You are offline. Cannot confirm attendance.");
            return;
        }

        setConfirming(true);
        setErrorMsg(null);
        try {
            const res = await fetch(ROUTES.api.attendance.confirm, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    checkpointId: selectedCheckpointId,
                    studentIdNumber: verification.target.studentIdNumber,
                    ...(breakGlassReason
                        ? { breakGlass: true, reason: breakGlassReason }
                        : {}),
                }),
            });
            const payload = (await res.json()) as {
                data?: { record: AttendanceRecordDto };
                error?: { message?: string };
            };
            if (!res.ok || !payload.data) {
                setErrorMsg(payload.error?.message ?? "Failed to confirm attendance.");
                return;
            }

            const confirmedRecord = payload.data.record;
            toast.success(
                `Logged ${confirmedRecord.fullName} (${confirmedRecord.studentIdNumber}).`,
            );
            setRecentScans((prev) => [confirmedRecord, ...prev].slice(0, 10));
            setCheckpoints((prev) =>
                prev.map((cp) =>
                    cp.id === selectedCheckpointId
                        ? { ...cp, recordCount: cp.recordCount + 1 }
                        : cp,
                ),
            );
            setManualId("");
            setVerification(null);
            resumeCameraIfPaused();
        } finally {
            setConfirming(false);
        }
    }

    function handleResetCard() {
        setVerification(null);
        setErrorMsg(null);
        resumeCameraIfPaused();
    }

    return (
        <div className="flex flex-col gap-6">
            {!isOnline ? (
                <div
                    role="alert"
                    aria-live="polite"
                    className="flex items-center gap-2.5 rounded-lg border border-warning/40 bg-warning/10 p-3.5 text-sm font-medium text-warning"
                >
                    <WifiOff className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>
                        You are offline. Live updates and attendance scanning require an internet
                        connection.
                    </span>
                </div>
            ) : null}

            {errorMsg ? (
                <div
                    role="alert"
                    aria-live="polite"
                    className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm font-medium text-destructive"
                >
                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span>{errorMsg}</span>
                </div>
            ) : null}

            <Card>
                <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <label htmlFor="scanner-checkpoint" className="text-xs font-medium">
                                Active OPEN Checkpoint
                            </label>
                            <select
                                id="scanner-checkpoint"
                                value={selectedCheckpointId}
                                onChange={(e) => void handleCheckpointChange(e.target.value)}
                                disabled={checkpoints.length === 0}
                                className="min-h-11 rounded-md border border-border bg-muted px-3 text-sm sm:min-h-10"
                            >
                                {checkpoints.length === 0 ? (
                                    <option value="">No OPEN checkpoints available</option>
                                ) : (
                                    checkpoints.map((cp) => (
                                        <option key={cp.id} value={cp.id}>
                                            {cp.parentTitle} &mdash; {cp.label} ({cp.audienceScope})
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>

                        <div className="flex items-center gap-2">
                            {selectedCheckpoint ? (
                                <Badge variant="brand" className="font-mono">
                                    {selectedCheckpoint.recordCount} logs
                                </Badge>
                            ) : null}
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => void handleRefreshCheckpoints()}
                            >
                                <RefreshCw className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                <span>Refresh</span>
                            </Button>
                        </div>
                    </div>

                    {selectedCheckpoint ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{selectedCheckpoint.termCode}</span>
                            <span>&middot;</span>
                            <span>Scope: {selectedCheckpoint.audienceScope}</span>
                            <span>&middot;</span>
                            <span>
                                {actorRole === "OFFICER"
                                    ? "General Member check-ins only (Executive required for Officers)"
                                    : "Authorized for all eligible attendees"}
                            </span>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {checkpoints.length === 0 ? (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                        <QrCode
                            className="size-10 text-muted-foreground"
                            strokeWidth={1.5}
                            aria-hidden="true"
                        />
                        <p className="max-w-md text-sm text-muted-foreground">
                            No attendance checkpoints are currently OPEN. An Executive must publish
                            the event and flip a checkpoint to OPEN before scanning begins.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Step 1 &mdash; Camera &amp; Manual ID Lookup</CardTitle>
                            <CardDescription>
                                Camera decoding pauses automatically upon match so you can verify
                                student identity before confirming.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4">
                            <div className="overflow-hidden rounded-lg border border-border bg-muted">
                                <div
                                    id={READER_REGION_ID}
                                    className="min-h-56 w-full"
                                />
                            </div>

                            {cameraError ? (
                                <p className="text-xs font-medium text-warning">{cameraError}</p>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                                {!cameraActive ? (
                                    <Button
                                        type="button"
                                        className="min-h-11 flex-1"
                                        disabled={cameraStarting || !isOnline}
                                        onClick={() => void startCamera(facingMode)}
                                    >
                                        {cameraStarting ? (
                                            <Loader2
                                                className="size-4 animate-spin"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                        ) : (
                                            <Camera
                                                className="size-4"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                        )}
                                        <span>
                                            {cameraStarting ? "Starting Camera..." : "Start Camera"}
                                        </span>
                                    </Button>
                                ) : (
                                    <>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            className="min-h-11 flex-1"
                                            onClick={() => {
                                                const nextFacing =
                                                    facingMode === "environment"
                                                        ? "user"
                                                        : "environment";
                                                setFacingMode(nextFacing);
                                                void startCamera(nextFacing);
                                            }}
                                        >
                                            <RefreshCw
                                                className="size-4"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            <span>Switch Camera</span>
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            className="min-h-11"
                                            onClick={() => void stopCameraSafely()}
                                        >
                                            <CameraOff
                                                className="size-4"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                            <span>Stop</span>
                                        </Button>
                                    </>
                                )}
                            </div>

                            <form
                                onSubmit={handleManualSubmit}
                                className="flex flex-col gap-2 border-t border-border pt-4"
                            >
                                <label htmlFor="manual-student-id" className="text-xs font-medium">
                                    Manual Student ID Fallback
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        id="manual-student-id"
                                        placeholder="e.g. 2024-01234"
                                        className="min-h-11 font-mono"
                                        value={manualId}
                                        onChange={(e) => setManualId(e.target.value)}
                                        disabled={!isOnline || lookingUp}
                                    />
                                    <Button
                                        type="submit"
                                        variant="secondary"
                                        className="min-h-11"
                                        disabled={!isOnline || lookingUp || !manualId.trim()}
                                    >
                                        {lookingUp ? (
                                            <Loader2
                                                className="size-4 animate-spin"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                        ) : (
                                            <Search
                                                className="size-4"
                                                strokeWidth={1.75}
                                                aria-hidden="true"
                                            />
                                        )}
                                        <span>Verify ID</span>
                                    </Button>
                                </div>
                            </form>
                        </CardContent>
                    </Card>

                    <div className="flex flex-col gap-6">
                        {verification ? (
                            <VerificationCard
                                key={`${verification.verificationState}:${verification.target?.id ?? "none"}:${verification.checkpoint.id}`}
                                result={verification}
                                isOnline={isOnline}
                                confirming={confirming}
                                onConfirm={(reason) => void handleConfirm(reason)}
                                onReset={handleResetCard}
                            />
                        ) : (
                            <Card>
                                <CardHeader>
                                    <CardTitle>Step 2 &mdash; Verification Card</CardTitle>
                                    <CardDescription>
                                        Scan a student QR code or enter an ID manually to preview
                                        identity and eligibility before committing.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
                                    <QrCode
                                        className="size-10 text-muted-foreground"
                                        strokeWidth={1.5}
                                        aria-hidden="true"
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        Waiting for next scan or Student ID lookup.
                                    </p>
                                </CardContent>
                            </Card>
                        )}

                        <Card>
                            <CardHeader>
                                <CardTitle>Recent Confirmed Scans</CardTitle>
                                <CardDescription>
                                    Latest logs recorded for{" "}
                                    <span className="font-medium text-foreground">
                                        {selectedCheckpoint?.label ?? "selected checkpoint"}
                                    </span>
                                    .
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {recentScans.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-muted-foreground">
                                        No attendance logs recorded for this checkpoint yet.
                                    </p>
                                ) : (
                                    <ul className="divide-y divide-border">
                                        {recentScans.map((scan) => (
                                            <li
                                                key={scan.id}
                                                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">
                                                        {scan.fullName}
                                                    </p>
                                                    <p className="font-mono text-xs text-muted-foreground">
                                                        {scan.studentIdNumber} &middot;{" "}
                                                        {scan.status}
                                                    </p>
                                                </div>
                                                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                                    {formatManilaTimestamp(scan.recordedAt)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
        </div>
    );
}

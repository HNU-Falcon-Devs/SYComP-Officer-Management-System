"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, KeyRound, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ForgotPasswordFormProps {
    universityDomain: string;
}

export function ForgotPasswordForm({ universityDomain }: ForgotPasswordFormProps) {
    const router = useRouter();
    const [step, setStep] = useState<"request" | "confirm">("request");
    const [studentIdNumber, setStudentIdNumber] = useState("");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);
        setStatusMessage(null);
        setSubmitting(true);

        try {
            const response = await fetch(ROUTES.api.auth.resetRequest, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    studentIdNumber: studentIdNumber.trim(),
                    email: email.trim(),
                }),
            });

            const payload = (await response.json()) as {
                data?: { message: string };
                error?: { message?: string };
            };

            if (!response.ok) {
                setErrorMessage(payload.error?.message ?? "Unable to process password reset request.");
                return;
            }

            setStatusMessage(
                payload.data?.message ??
                    "If an active verified account matches, a 6-digit code was sent.",
            );
            setStep("confirm");
        } catch {
            setErrorMessage("Network error. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleConfirmReset(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);

        if (newPassword !== confirmPassword) {
            setErrorMessage("New password and confirmation do not match.");
            return;
        }

        setSubmitting(true);
        try {
            const response = await fetch(ROUTES.api.auth.resetConfirm, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    studentIdNumber: studentIdNumber.trim(),
                    email: email.trim(),
                    code: code.trim(),
                    newPassword,
                }),
            });

            const payload = (await response.json()) as {
                error?: { message?: string };
            };

            if (!response.ok) {
                setErrorMessage(payload.error?.message ?? "Failed to reset password.");
                return;
            }

            toast.success("Password updated. Sign in with your new password.");
            router.push(ROUTES.auth.login);
        } catch {
            setErrorMessage("Network error. Please try again.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <h1 className="text-2xl font-semibold tracking-tight">Reset password</h1>
                <CardDescription>
                    Verify your Student ID and verified{" "}
                    <span className="font-mono text-foreground">@{universityDomain}</span> email.
                    Unverified accounts must contact SYComP administration.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {errorMessage ? (
                    <div
                        role="alert"
                        aria-live="polite"
                        className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
                    >
                        <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <span>{errorMessage}</span>
                    </div>
                ) : null}

                {statusMessage ? (
                    <div
                        role="status"
                        aria-live="polite"
                        className="flex items-start gap-2.5 rounded-md border border-info/30 bg-info/10 p-3 text-xs text-foreground"
                    >
                        <MailCheck className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={1.75} aria-hidden="true" />
                        <span>{statusMessage}</span>
                    </div>
                ) : null}

                {step === "request" ? (
                    <form onSubmit={handleRequestOtp} className="flex flex-col gap-4" noValidate>
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="reset-student-id" className="text-xs font-medium">
                                Student ID Number
                            </label>
                            <Input
                                id="reset-student-id"
                                placeholder="2024-01234"
                                className="font-mono"
                                value={studentIdNumber}
                                onChange={(e) => setStudentIdNumber(e.target.value)}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="reset-email" className="text-xs font-medium">
                                Verified University Email
                            </label>
                            <Input
                                id="reset-email"
                                type="email"
                                placeholder={`name@${universityDomain}`}
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                        </div>

                        <Button type="submit" disabled={submitting} className="w-full">
                            {submitting ? (
                                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                                <KeyRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
                            )}
                            <span>{submitting ? "Sending code..." : "Send 6-digit code"}</span>
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleConfirmReset} className="flex flex-col gap-4" noValidate>
                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="reset-otp" className="text-xs font-medium">
                                6-Digit Verification Code
                            </label>
                            <Input
                                id="reset-otp"
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="000000"
                                className="font-mono tracking-widest"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="reset-new-password" className="text-xs font-medium">
                                New Password (min 10 chars, letter + number)
                            </label>
                            <Input
                                id="reset-new-password"
                                type="password"
                                autoComplete="new-password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label htmlFor="reset-confirm-password" className="text-xs font-medium">
                                Confirm New Password
                            </label>
                            <Input
                                id="reset-confirm-password"
                                type="password"
                                autoComplete="new-password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Button
                                variant="secondary"
                                onClick={() => setStep("request")}
                                className="sm:flex-1"
                            >
                                Resend code
                            </Button>
                            <Button type="submit" disabled={submitting} className="sm:flex-1">
                                {submitting ? "Updating..." : "Reset password"}
                            </Button>
                        </div>
                    </form>
                )}

                <Link
                    href={ROUTES.auth.login}
                    className="inline-flex min-h-10 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    <span>Back to sign in</span>
                </Link>
            </CardContent>
        </Card>
    );
}

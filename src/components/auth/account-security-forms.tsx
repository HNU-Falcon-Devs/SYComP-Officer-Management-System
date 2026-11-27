"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
    AlertCircle,
    CheckCircle2,
    KeyRound,
    Loader2,
    Mail,
    ShieldAlert,
    ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import type { SessionActorDto } from "@/lib/auth/dto";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface AccountSecurityFormsProps {
    actor: SessionActorDto;
    universityDomain: string;
}

export function AccountSecurityForms({ actor, universityDomain }: AccountSecurityFormsProps) {
    const router = useRouter();

    const [email, setEmail] = useState(actor.universityEmail ?? "");
    const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
    const [otpCode, setOtpCode] = useState("");
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailError, setEmailError] = useState<string | null>(null);

    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [pwLoading, setPwLoading] = useState(false);
    const [pwError, setPwError] = useState<string | null>(null);

    async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setEmailError(null);
        setEmailLoading(true);

        try {
            const response = await fetch(ROUTES.api.auth.requestOtp, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim() }),
            });
            const payload = (await response.json()) as {
                data?: { targetEmail: string };
                error?: { message?: string };
            };

            if (!response.ok) {
                setEmailError(payload.error?.message ?? "Failed to send verification code.");
                return;
            }

            setOtpSentTo(payload.data?.targetEmail ?? email.trim());
            toast.success("6-digit verification code sent.");
        } catch {
            setEmailError("Network error. Please try again.");
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setEmailError(null);
        setEmailLoading(true);

        try {
            const response = await fetch(ROUTES.api.auth.verifyOtp, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: (otpSentTo ?? email).trim(),
                    code: otpCode.trim(),
                }),
            });
            const payload = (await response.json()) as {
                error?: { message?: string };
            };

            if (!response.ok) {
                setEmailError(payload.error?.message ?? "Invalid verification code.");
                return;
            }

            setOtpCode("");
            setOtpSentTo(null);
            toast.success("University email verified.");
            router.refresh();
        } catch {
            setEmailError("Network error. Please try again.");
        } finally {
            setEmailLoading(false);
        }
    }

    async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPwError(null);

        if (newPassword !== confirmPassword) {
            setPwError("New password and confirmation do not match.");
            return;
        }

        setPwLoading(true);
        try {
            const response = await fetch(ROUTES.api.auth.passwordChange, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const payload = (await response.json()) as {
                error?: { message?: string };
            };

            if (!response.ok) {
                setPwError(payload.error?.message ?? "Unable to update password.");
                return;
            }

            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            toast.success("Password updated. Other active sessions were signed out.");
            router.refresh();
        } catch {
            setPwError("Network error. Please try again.");
        } finally {
            setPwLoading(false);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>Identity & Security Status</CardTitle>
                    <CardDescription>
                        Institutional profile details synchronized from the active masterlist.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-3">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Full Name</p>
                        <p className="mt-1 text-sm font-medium">{actor.fullName}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Student ID</p>
                        <p className="mt-1 font-mono text-sm font-medium">{actor.studentIdNumber}</p>
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">Security Checks</p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                            {actor.emailVerified ? (
                                <Badge variant="success">
                                    <ShieldCheck className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    Email Verified
                                </Badge>
                            ) : (
                                <Badge variant="warning">
                                    <ShieldAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    Email Unverified
                                </Badge>
                            )}
                            {actor.mustChangePassword ? (
                                <Badge variant="warning">Default Password</Badge>
                            ) : (
                                <Badge variant="success">
                                    <CheckCircle2 className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                                    Password Set
                                </Badge>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>University Email Binding</CardTitle>
                        <CardDescription>
                            Bind your official{" "}
                            <span className="font-mono text-foreground">@{universityDomain}</span>{" "}
                            email for OTP self-service password recovery.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                        {emailError ? (
                            <div
                                role="alert"
                                aria-live="polite"
                                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
                            >
                                <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                <span>{emailError}</span>
                            </div>
                        ) : null}

                        <form onSubmit={handleRequestOtp} className="flex flex-col gap-3" noValidate>
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="bind-email" className="text-xs font-medium">
                                    University Email
                                </label>
                                <Input
                                    id="bind-email"
                                    type="email"
                                    placeholder={`student@${universityDomain}`}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <Button type="submit" variant="secondary" disabled={emailLoading}>
                                {emailLoading ? (
                                    <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                                ) : (
                                    <Mail className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                )}
                                <span>{otpSentTo ? "Resend 6-digit OTP" : "Send verification OTP"}</span>
                            </Button>
                        </form>

                        {otpSentTo ? (
                            <form
                                onSubmit={handleVerifyOtp}
                                className="flex flex-col gap-3 border-t border-border pt-4"
                                noValidate
                            >
                                <div className="flex flex-col gap-1.5">
                                    <label htmlFor="bind-otp" className="text-xs font-medium">
                                        6-Digit Code sent to{" "}
                                        <span className="font-mono">{otpSentTo}</span>
                                    </label>
                                    <Input
                                        id="bind-otp"
                                        inputMode="numeric"
                                        maxLength={6}
                                        placeholder="000000"
                                        className="font-mono tracking-widest"
                                        value={otpCode}
                                        onChange={(e) => setOtpCode(e.target.value)}
                                        required
                                    />
                                </div>
                                <Button type="submit" disabled={emailLoading}>
                                    Verify &amp; bind email
                                </Button>
                            </form>
                        ) : null}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Update Password</CardTitle>
                        <CardDescription>
                            Minimum 10 characters with at least one letter and one number. Updating
                            revokes all other active sessions.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleChangePassword} className="flex flex-col gap-3" noValidate>
                            {pwError ? (
                                <div
                                    role="alert"
                                    aria-live="polite"
                                    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive"
                                >
                                    <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                                    <span>{pwError}</span>
                                </div>
                            ) : null}

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="current-password" className="text-xs font-medium">
                                    Current Password
                                </label>
                                <Input
                                    id="current-password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="new-password" className="text-xs font-medium">
                                    New Password
                                </label>
                                <Input
                                    id="new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="confirm-new-password" className="text-xs font-medium">
                                    Confirm New Password
                                </label>
                                <Input
                                    id="confirm-new-password"
                                    type="password"
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                />
                            </div>

                            <Button type="submit" disabled={pwLoading} className="mt-1">
                                {pwLoading ? (
                                    <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                                ) : (
                                    <KeyRound className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                )}
                                <span>{pwLoading ? "Updating..." : "Update password"}</span>
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

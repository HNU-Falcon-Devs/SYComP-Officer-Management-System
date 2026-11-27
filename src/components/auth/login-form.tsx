"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { ROUTES } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface LoginFormProps {
    nextPath?: string | null;
}

export function LoginForm({ nextPath }: LoginFormProps) {
    const router = useRouter();
    const [studentIdNumber, setStudentIdNumber] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setErrorMessage(null);
        setSubmitting(true);

        try {
            const response = await fetch(ROUTES.api.auth.login, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    studentIdNumber: studentIdNumber.trim(),
                    password,
                    ...(nextPath ? { next: nextPath } : {}),
                }),
            });

            const payload = (await response.json()) as {
                data?: { redirectTo: string };
                error?: { code?: string; message?: string; details?: { redirectTo?: string } };
            };

            if (!response.ok) {
                if (payload.error?.code === "ACCOUNT_HOLD" && payload.error.details?.redirectTo) {
                    router.push(payload.error.details.redirectTo);
                    return;
                }
                setErrorMessage(payload.error?.message ?? "Unable to sign in. Please try again.");
                return;
            }

            toast.success("Signed in to SYComP OMS.");
            router.push(payload.data?.redirectTo ?? ROUTES.portal.home);
            router.refresh();
        } catch {
            setErrorMessage("Network error. Check your internet connection and try again.");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Card className="w-full max-w-md">
            <CardHeader>
                <h1 className="text-2xl font-semibold tracking-tight">Sign in to SYComP OMS</h1>
                <CardDescription>
                    Use your Student ID number and password provisioned for the active semester.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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

                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="student-id" className="text-xs font-medium text-foreground">
                            Student ID Number
                        </label>
                        <Input
                            id="student-id"
                            name="studentIdNumber"
                            autoComplete="username"
                            placeholder="2024-01234"
                            className="font-mono"
                            value={studentIdNumber}
                            onChange={(e) => setStudentIdNumber(e.target.value)}
                            required
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                            <label htmlFor="password" className="text-xs font-medium text-foreground">
                                Password
                            </label>
                            <Link
                                href={ROUTES.auth.forgotPassword}
                                className="text-xs font-medium text-primary hover:underline dark:text-brand-accent"
                            >
                                Forgot password?
                            </Link>
                        </div>
                        <div className="relative">
                            <Input
                                id="password"
                                name="password"
                                type={showPassword ? "text" : "password"}
                                autoComplete="current-password"
                                className="pr-11"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                            <button
                                type="button"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                                onClick={() => setShowPassword((prev) => !prev)}
                                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                            >
                                {showPassword ? (
                                    <EyeOff className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                ) : (
                                    <Eye className="size-4" strokeWidth={1.75} aria-hidden="true" />
                                )}
                            </button>
                        </div>
                    </div>

                    <Button type="submit" disabled={submitting} className="mt-1 w-full">
                        {submitting ? (
                            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                        ) : (
                            <LogIn className="size-4" strokeWidth={1.75} aria-hidden="true" />
                        )}
                        <span>{submitting ? "Signing in..." : "Sign in"}</span>
                    </Button>

                    <p className="text-xs leading-relaxed text-muted-foreground">
                        First-time login uses your normalized surname plus Student ID (example:{" "}
                        <span className="font-mono text-foreground">delacruz2024-01234</span>).
                    </p>
                </form>
            </CardContent>
        </Card>
    );
}

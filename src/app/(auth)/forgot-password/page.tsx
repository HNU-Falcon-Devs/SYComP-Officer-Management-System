import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export default function ForgotPasswordPage() {
    const universityDomain = process.env.UNIVERSITY_EMAIL_DOMAIN ?? "hnu.edu.ph";
    return <ForgotPasswordForm universityDomain={universityDomain} />;
}

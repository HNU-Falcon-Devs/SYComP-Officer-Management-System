import { AccountSecurityForms } from "@/components/auth/account-security-forms";
import { requireServerAuth } from "@/lib/auth/server";

export default async function WorkspaceAccountPage() {
    const { actor } = await requireServerAuth("account:self:update", {});
    const universityDomain = process.env.UNIVERSITY_EMAIL_DOMAIN ?? "hnu.edu.ph";

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">Account Security</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Bind your official university email and update your officer password.
                </p>
            </div>
            <AccountSecurityForms actor={actor} universityDomain={universityDomain} />
        </div>
    );
}

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";

export default function AcceptInvitationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [status, setStatus] = useState<"loading" | "accepting" | "done" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      // Bounce to sign-in, then come back here.
      router.push(`/sign-in?redirect=/accept-invitation/${id}`);
      return;
    }
    (async () => {
      setStatus("accepting");
      const res = await authClient.organization.acceptInvitation({ invitationId: id });
      if (res.error) {
        setStatus("error");
        setMessage(res.error.message ?? "This invitation is invalid or has expired.");
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orgId = (res.data as any)?.invitation?.organizationId ?? (res.data as any)?.organizationId;
      if (orgId) await authClient.organization.setActive({ organizationId: orgId });
      setStatus("done");
      setTimeout(() => router.push("/dashboard"), 1200);
    })();
  }, [isPending, session, id, router]);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <h1 className="font-display text-xl font-bold">Workspace invitation</h1>
        <p className="mt-3 text-sm text-ink-soft">
          {status === "loading" && "Checking your invitation…"}
          {status === "accepting" && "Accepting invitation…"}
          {status === "done" && "You're in! Redirecting to your dashboard…"}
          {status === "error" && message}
        </p>
        {status === "error" && (
          <button onClick={() => router.push("/dashboard")} className="btn btn-primary mt-6 text-sm">
            Go to dashboard
          </button>
        )}
      </div>
    </main>
  );
}

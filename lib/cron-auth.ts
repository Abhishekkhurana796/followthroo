/**
 * Authorize scheduled/cron trigger requests to the poller + warm-up endpoints.
 *
 * Two triggers are accepted, and both are cryptographically checked:
 *
 *   - Vercel Cron (vercel.json). Vercel automatically sends the project's CRON_SECRET
 *     as `Authorization: Bearer <secret>`, which is the bearer branch below. This is
 *     the primary scheduler — set CRON_SECRET in the Vercel project or every cron
 *     invocation is rejected.
 *   - QStash Schedules, which sign every request, so no shared secret is required.
 *     Kept as the fallback for non-Vercel hosting.
 *
 * A CRON_SECRET bearer also covers manual runs (curl, the verify scripts).
 *
 * NOTE: we deliberately do NOT trust `x-vercel-cron` — external clients can spoof it, and
 * these endpoints fan out across every org, so a header check would be a tenant-data leak.
 */
import { env } from "./env";
import { safeEqual } from "./webhook-auth";

export async function isAuthorizedCron(req: Request, rawBody = ""): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  const authz = req.headers.get("authorization");
  // Constant-time: a plain === on a secret leaks its prefix a byte at a time to
  // anyone who can time the response, and these endpoints fan out across orgs.
  if (cronSecret && safeEqual(authz, `Bearer ${cronSecret}`)) return true;

  const signature = req.headers.get("upstash-signature");
  if (signature && env.qstash.currentSigningKey && env.qstash.nextSigningKey) {
    try {
      const { Receiver } = await import("@upstash/qstash");
      const receiver = new Receiver({
        currentSigningKey: env.qstash.currentSigningKey,
        nextSigningKey: env.qstash.nextSigningKey,
      });
      const url = `${env.appUrl}${new URL(req.url).pathname}`;
      return await receiver.verify({ signature, body: rawBody, url });
    } catch {
      return false;
    }
  }
  return false;
}

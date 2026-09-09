import { ok } from "@/lib/http";
import { configured } from "@/lib/env";
import { encryptionConfigured } from "@/lib/crypto";

export const runtime = "nodejs";

// GET /api/status — quick health + which integrations are wired.
export async function GET() {
  return ok({
    app: "followthroo",
    configured: {
      database: configured.db,
      redis: configured.redis,
      email: configured.email,
      whatsapp: configured.whatsapp,
      linkedin: configured.linkedin,
      agent: configured.agent,
      openrouter: configured.openrouter,
      meta: configured.meta,
      googleAds: configured.googleAds,
      storefront: configured.storefront,
      // False when ENCRYPTION_KEYS is missing OR malformed (the keyring throws on
      // a bad key and encryptionConfigured swallows it), so this is the one check
      // that tells you a deployed environment can actually seal a credential.
      encryption: encryptionConfigured(),
    },
  });
}

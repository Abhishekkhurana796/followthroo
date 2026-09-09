/**
 * Lead sources — inbound adapters plus optional monthly spend, so the ageing
 * view's source labels and the PRD's cost-per-source ROI reporting have
 * something to join against. The four known keys are seeded with a friendly
 * label and setup copy on first visit; ingestion itself never depends on a
 * `LeadSource` row existing (an unrecognised key still lands, it just has no
 * label or cost attached).
 */
import { prisma } from "./db";
import { ingestKeyFor } from "./ingest-key";
import { env, configured } from "./env";

/** Sources whose adapter needs env-level credentials before the webhook will accept
 *  anything — checked against `configured` rather than assumed always-ready. */
const ENV_GATED_SOURCES: Record<string, keyof typeof configured> = {
  meta_lead_ads: "meta",
  google_ads: "googleAds",
};

export type SourceInfo = { key: string; label: string; instructions: string };

export const KNOWN_SOURCES: SourceInfo[] = [
  {
    key: "manual",
    label: "Manual",
    instructions:
      "Contacts you add by hand in Followthroo. Nothing to configure — this is the default source for the Add contact form.",
  },
  {
    key: "csv",
    label: "CSV import",
    instructions:
      "Contacts brought in by uploading a spreadsheet. Nothing to configure — imports are tagged with this source automatically.",
  },
  {
    key: "linkedin_search",
    label: "LinkedIn search",
    instructions:
      "Contacts pulled from a LinkedIn search, company page, group or event, via the Followthroo extension. Nothing to configure — paste a LinkedIn URL under Leads → Add Lead → Find leads.",
  },
  {
    key: "linkedin_profile",
    label: "LinkedIn profile",
    instructions:
      "A single LinkedIn profile you scraped directly. Nothing to configure.",
  },
  {
    key: "linkedin_engagement",
    label: "LinkedIn engagement",
    instructions:
      "People who liked or commented on a post — usually the warmest LinkedIn list, because they raised their hand in public. Nothing to configure.",
  },
  {
    key: "web_form",
    label: "Website form",
    instructions:
      "POST form submissions as JSON to the URL below. No auth header needed — the key in the URL is the credential.",
  },
  {
    key: "indiamart",
    label: "IndiaMART",
    instructions:
      'Seller panel → Lead Manager → Import/Export Leads → Push API. Choose "Other" as your platform and paste the URL below as the webhook listener.',
  },
  {
    key: "justdial",
    label: "JustDial",
    instructions:
      "There's no self-serve portal for this one — ask your JustDial account manager to deliver leads to the URL below, and get a sample payload from them first.",
  },
  {
    key: "meta_lead_ads",
    label: "Meta Lead Ads",
    instructions:
      'Meta App Dashboard → Webhooks → Page → Subscribe to the "leadgen" field. Use the URL below, and set the Verify Token to whatever you put in META_VERIFY_TOKEN.',
  },
  {
    key: "google_ads",
    label: "Google Ads Lead Forms",
    instructions:
      'Lead form asset editor → "Other data integration options" → Webhook integration. Paste the URL below, set the key to whatever you put in GOOGLE_ADS_WEBHOOK_KEY, then use "Send test data" to confirm before going live.',
  },
  {
    key: "sulekha",
    label: "Sulekha",
    instructions:
      "No self-serve API — ask Sulekha's seller/account support team to deliver leads to the URL below. Get a sample payload from them first; the field mapping here is a best-effort default.",
  },
  {
    key: "tradeindia",
    label: "TradeIndia",
    instructions:
      "No self-serve API — ask TradeIndia's account manager to deliver leads to the URL below. Get a sample payload from them first; the field mapping here is a best-effort default.",
  },
];

/** Deterministic per-org, per-source webhook URL third parties post leads to. */
export function ingestUrlFor(organizationId: string, sourceKey: string): string {
  return `${env.appUrl}/api/inbound/${sourceKey}?org=${organizationId}&key=${ingestKeyFor(organizationId)}`;
}

/** Idempotent: seeds the 4 known sources for an org the first time anyone visits. */
export async function ensureKnownSources(organizationId: string) {
  await prisma.leadSource.createMany({
    data: KNOWN_SOURCES.map((s) => ({ organizationId, key: s.key, label: s.label })),
    skipDuplicates: true,
  });
}

export async function listSources(organizationId: string) {
  await ensureKnownSources(organizationId);
  const sources = await prisma.leadSource.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  return sources.map((s) => {
    const info = KNOWN_SOURCES.find((k) => k.key === s.key);
    return {
      id: s.id,
      key: s.key,
      label: s.label,
      monthlyCost: s.monthlyCost ? Number(s.monthlyCost) : null,
      active: s.active,
      // Who contacts from this source land on — see lib/assignment.ts.
      assignmentRule: s.assignmentRule,
      assignedToId: s.assignedToId,
      assignmentDept: s.assignmentDept,
      instructions: info?.instructions ?? "Custom source — map its payload fields in lib/channels/inbound.ts.",
      ingestUrl: ingestUrlFor(organizationId, s.key),
      // Most sources need only the URL; Meta and Google Ads additionally need env-level
      // credentials (signature/verify-token, or a shared webhook key) before they'll work.
      needsEnvSetup: s.key in ENV_GATED_SOURCES && !configured[ENV_GATED_SOURCES[s.key]],
    };
  });
}

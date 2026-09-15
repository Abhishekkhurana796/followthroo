import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";

export const metadata = { title: "Lead sources guide - Followthroo", description: "Connect webhook lead sources and understand source delivery status in Followthroo." };

const sources = [
  ["IndiaMART", "In Seller Panel → Lead Manager, configure the Followthroo source URL as the Push API listener. Pull API backfill is separate and requires its provider key."],
  ["JustDial", "Ask your account manager to deliver leads to the source URL. Send a real sample payload before treating the mapping as certified; each account can use different fields."],
  ["Meta Lead Ads", "Configure the Page leadgen webhook with the Followthroo URL and verify token. Followthroo verifies Meta's signed request, then retrieves field values from Graph using configured provider credentials."],
  ["Google Ads Lead Forms", "In the lead form asset webhook integration, paste the source URL and set the same webhook key configured for your workspace. Use Google's Send test data action before going live."],
] as const;

export default function LeadSourcesDocsPage() {
  return <SiteShell><PageHero kicker="Docs / Lead sources" title="Connect lead sources with a real delivery check" subtitle="Every source has its own webhook URL under Settings → Lead sources. Give that exact URL to the provider, then verify a real test delivery." />
    <main className="bg-canvas pb-24"><div className="mx-auto max-w-4xl space-y-8 px-6">
      <section className="rounded-2xl border border-line bg-surface p-6"><h2 className="font-display text-xl font-bold">Read source status correctly</h2><ul className="mt-3 space-y-2 text-sm text-ink-soft"><li><b className="text-ink">Configured:</b> provider credentials are present and Followthroo has accepted an authenticated delivery.</li><li><b className="text-ink">Awaiting provider credentials:</b> a required Meta or Google credential is missing.</li><li><b className="text-ink">Awaiting provider test delivery:</b> the URL is ready, but no real provider payload has been confirmed yet.</li><li><b className="text-ink">Last failed delivery:</b> shows an authenticated delivery failure reason without storing the provider payload.</li></ul></section>
      {sources.map(([name, body], i) => <section key={name} className="rounded-2xl border border-line bg-surface p-6"><p className="font-mono text-xs text-accent">0{i + 1}</p><h2 className="mt-2 font-display text-xl font-bold">{name}</h2><p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p></section>)}
      <section className="rounded-2xl border border-warning/30 bg-warning/10 p-6"><h2 className="font-display text-xl font-bold">Do not mark an integration live from configuration alone</h2><p className="mt-2 text-sm leading-relaxed text-ink-soft">A configured URL or environment variable does not prove the provider can deliver usable contacts. Run a provider test or use a real sample. Duplicates are deduplicated by the provider&apos;s stable lead identifier when available; a payload with no email or phone is acknowledged but does not create a lead.</p></section>
    </div></main></SiteShell>;
}

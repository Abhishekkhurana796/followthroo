import Link from "next/link";
import { ExternalLink } from "lucide-react";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { DESKTOP_APP_URL, EXTENSION_STORE_URL } from "@/lib/constants";

export const metadata = {
  title: "LinkedIn guide - Followthroo",
  description: "Set up Followthroo for LinkedIn: source people with the extension, send safely from the desktop app, inspect logs, and use profile enrichment.",
};

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="rounded-2xl border border-line bg-surface p-5">
    <div className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">{n}</span>
      <div><h2 className="font-display text-lg font-bold">{title}</h2><div className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</div></div>
    </div>
  </li>
);

export default function LinkedInDocsPage() {
  return (
    <SiteShell>
      <PageHero kicker="Docs / LinkedIn" title="Source, send, and enrich LinkedIn leads" subtitle="The Chrome extension only reads pages you open. The Windows desktop app is the only component that sends invitations." />
      <main className="bg-canvas pb-24"><div className="mx-auto max-w-4xl space-y-12 px-6">
        <section>
          <h2 className="font-display text-2xl font-extrabold">1. Connect the Chrome extension</h2>
          <ol className="mt-5 space-y-3">
            <Step n={1} title="Install Followthroo for LinkedIn">
              Get it from the <a href={EXTENSION_STORE_URL} className="underline" target="_blank" rel="noreferrer">Chrome Web Store <ExternalLink className="inline h-3 w-3" /></a>.
            </Step>
            <Step n={2} title="Pair it with your workspace">
              In Followthroo, open <b>LinkedIn</b> and copy the pairing token from <b>Connect the Chrome extension</b>. Click the extension icon, choose <b>Settings</b>, set App URL to <code>https://app.followthroo.com</code>, paste the token, then select <b>Connect</b>.
            </Step>
            <Step n={3} title="Use it while signed in to LinkedIn">
              Keep LinkedIn signed in in that same Chrome or Edge profile. Open a people search, your connections, a company&apos;s people, or a profile, then tick the people you want. The extension adds people; it never sends an invitation or message.
            </Step>
          </ol>
          <p className="mt-4 text-sm text-ink-soft">For a long, existing list, use <Link href="/dashboard/leads" className="underline">Import CSV or Excel</Link> in Leads with a LinkedIn URL column.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-extrabold">2. Review imports and errors</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">Open <b>LinkedIn → Your LinkedIn → Logs</b>. Each record shows the source URL, source type, result count, imported count, time, and any readable selector or page-reading error. A selector error means Followthroo could not safely read that page; it does not mean the people were rejected.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-extrabold">3. Send connection requests from the desktop app</h2>
          <ol className="mt-5 space-y-3">
            <Step n={1} title="Queue an invitation">
              Select leads in Leads and choose <b>Connect on LinkedIn</b>, or add a LinkedIn connection-request step to a campaign. Review the note choice before sending.
            </Step>
            <Step n={2} title="Install the Windows app and sign in">
              {DESKTOP_APP_URL ? <a href={DESKTOP_APP_URL} className="underline">Download the desktop app</a> : <Link href="/desktop" className="underline">Open the desktop download page</Link>}. It opens a dedicated Chrome window using a browser profile stored on your computer.
            </Step>
            <Step n={3} title="Use the Send connections lane">
              The desktop shows the account&apos;s server-calculated sent count, remaining capacity, daily cap, and note allowance. The safe maximum is 20 invitations per account per day; you may set a lower account cap. Press <b>Send connections</b> only when you can leave that automation window alone.
            </Step>
          </ol>
          <p className="mt-4 text-sm text-ink-soft">The run stops on the daily cap, a LinkedIn limit wall, a sign-in prompt, or repeated technical failures. Sending automation can violate LinkedIn&apos;s terms and may restrict an account; use conservative limits and review your queue.</p>
        </section>

        <section>
          <h2 className="font-display text-2xl font-extrabold">4. Look up profile contact information</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft"><b>LinkedIn profile enrichment is available on Grow ($20/month) and Scale ($50/month).</b> Choose <b>Find email and phone</b> on a lead, select leads in bulk, or add the campaign step. The desktop&apos;s separate <b>Profile enrichment</b> lane performs the lookup; it never sends outreach.</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">Only confirmed 1st-degree connections are eligible. Followthroo checks the current profile badge, accessible label, and explicit Remove Connection action. It records a specific non-connection or unverified-degree reason instead of guessing. A lookup costs up to three credits: one is returned for each missing email or phone, and all are returned for a non-connection or technical failure.</p>
        </section>

        <section className="rounded-2xl border border-accent/25 bg-accent-soft/40 p-6">
          <h2 className="font-display text-xl font-bold">Quick troubleshooting</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-soft">
            <li><b className="text-ink">Extension is not connected:</b> verify its App URL is <code>https://app.followthroo.com</code>, paste a fresh token, and remain signed in to LinkedIn in the same browser.</li>
            <li><b className="text-ink">No invitations send:</b> check the desktop app&apos;s server usage/cap, LinkedIn sign-in, queue readiness, and the Activity log.</li>
            <li><b className="text-ink">Profile lookup is unavailable:</b> Grow or Scale is required; then check the separate enrichment lane and its queue.</li>
            <li><b className="text-ink">A page could not be read:</b> inspect LinkedIn → Your LinkedIn → Logs and share the page type and error with support.</li>
          </ul>
        </section>
      </div></main>
    </SiteShell>
  );
}

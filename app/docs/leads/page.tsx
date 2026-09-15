import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";

export const metadata = {
  title: "Import, filter and export leads — Followthroo docs",
  description: "Import CSV or Excel leads, filter the CRM, and export the exact result you need.",
};

const columns = ["email", "linkedin url", "first name", "last name", "company", "title", "phone", "tags"];

export default function LeadsDocsPage() {
  return (
    <SiteShell>
      <PageHero kicker="Leads" title="Bring your leads in, keep them useful" subtitle="CSV and Excel imports use the same straightforward format, so your team does not need a separate spreadsheet mapping." />
      <main className="mx-auto max-w-3xl space-y-10 px-6 py-14 text-ink">
        <section className="rounded-2xl border border-line bg-surface p-6">
          <h2 className="font-display text-2xl font-bold">Import CSV or Excel</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink-soft">
            <li>Open <Link href="/dashboard/leads" className="underline">Leads</Link>, then choose <strong className="text-ink">Add lead → Import CSV or Excel</strong>.</li>
            <li>Upload a `.csv` or `.xlsx` file. For Excel, Followthroo reads the first worksheet.</li>
            <li>Check the imported/skipped result. Every skipped row includes a readable reason.</li>
          </ol>
          <p className="mt-5 text-sm text-ink-soft">Use a header row and one person per following row. Every person needs an <code>email</code> or a <code>linkedin url</code>; everything else is optional.</p>
          <div className="mt-4 flex flex-wrap gap-2">{columns.map((column) => <code key={column} className="rounded-full bg-tint px-3 py-1 text-xs">{column}</code>)}</div>
          <pre className="mt-5 overflow-x-auto rounded-xl bg-ink p-4 text-xs text-ink-invert">{`first name,last name,email,linkedin url,company,title,phone,tags,city\nPriya,Shah,priya@acme.com,https://www.linkedin.com/in/priyashah,Acme,Head of HR,+91 98765 43210,"warm,hr",Mumbai`}</pre>
          <p className="mt-4 text-sm text-ink-soft">Headers ignore case and spaces. Extra columns, such as <code>city</code>, are stored as lead fields that can be used in template variables.</p>
        </section>
        <section>
          <h2 className="font-display text-2xl font-bold">Filter and export</h2>
          <p className="mt-3 text-sm text-ink-soft">Filter Leads by stage, owner, source, tags, group, search text, or LinkedIn profile. Owners and admins can choose Export CSV to download precisely that filtered, authorized result, including custom imported columns.</p>
        </section>
        <section>
          <h2 className="font-display text-2xl font-bold">Attachments in email templates</h2>
          <p className="mt-3 text-sm text-ink-soft">Open an email template and attach up to five files (10 MB each). A campaign automatically sends the attachments saved on its selected template. Gmail and SMTP accounts support attachments; Zoho templates show a clear limitation instead of sending a message without the requested files.</p>
        </section>
      </main>
    </SiteShell>
  );
}

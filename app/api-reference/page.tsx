import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";

export const metadata = { title: "API Reference — Followthroo" };

const ROUTES = [
  { method: "GET/POST", path: "/api/leads", desc: "List or upsert leads (dedupe by email)." },
  { method: "GET/PATCH/DELETE", path: "/api/leads/:id", desc: "Read, update, or GDPR-delete a lead." },
  { method: "POST", path: "/api/leads/import", desc: "CSV import; unknown columns become variables." },
  { method: "GET/POST/PUT", path: "/api/campaigns", desc: "List, create, or launch a sequence." },
  { method: "POST", path: "/api/agent", desc: "Run the Claude orchestration agent." },
  { method: "POST", path: "/api/webhooks/email", desc: "Bounce / complaint / open handling." },
  { method: "POST", path: "/api/webhooks/whatsapp", desc: "Delivery status + inbound opt-out." },
  { method: "GET", path: "/api/status", desc: "Health + which integrations are configured." },
];

export default function ApiReferencePage() {
  return (
    <SiteShell>
      <PageHero kicker="API Reference" title="A small, honest REST API" subtitle="Everything the dashboard does, you can do over HTTP. Node runtime, JSON in and out." />

      <section className="bg-canvas pb-8">
        <div className="mx-auto max-w-4xl px-6">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-tint font-mono text-xs uppercase tracking-wider text-ink-soft">
                <tr>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Path</th>
                  <th className="px-4 py-3">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ROUTES.map((r) => (
                  <tr key={r.path}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.method}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.path}</td>
                    <td className="px-4 py-3 text-ink-soft">{r.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-canvas pb-24">
        <div className="mx-auto max-w-4xl px-6">
          <pre className="overflow-x-auto rounded-2xl bg-ink p-6 font-mono text-sm text-ink-invert/90">{`curl -X POST localhost:3000/api/leads \\
  -H 'content-type: application/json' \\
  -d '{"email":"jane@acme.com","firstName":"Jane","company":"Acme"}'`}</pre>
        </div>
      </section>
    </SiteShell>
  );
}

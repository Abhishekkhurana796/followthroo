import Link from "next/link";
import { Check, Minus } from "lucide-react";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { CTABand } from "@/components/site/blocks";
import FAQ from "@/components/marketing/FAQ";
import {
  CREDIT_COSTS,
  PLAN_ORDER,
  PLANS,
  TOP_UP_PACKS,
  hasFeature,
  packCreditRate,
  periodCredits,
  planCreditRate,
  type Plan,
  type PlanId,
} from "@/lib/billing/plans";

const DESCRIPTION =
  "Every plan has the CRM, the inbox and every channel, with credits that refill every day. Try it on your own leads for $2, then from $10 a month.";

export const metadata = {
  title: "Pricing — Followthroo",
  description: DESCRIPTION,
  openGraph: { title: "Pricing — Followthroo", description: DESCRIPTION, url: "https://followthroo.com/pricing" },
};

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const PLANS_SHOWN = PLAN_ORDER.map((id) => PLANS[id]);
const POPULAR: PlanId = "grow";

/**
 * The only words on this page that aren't read from lib/billing/plans.ts: what a
 * day's credits buys, and each plan's headline extras. Prices, limits, credits
 * and costs all come from there, so this page can't disagree with Billing or
 * with what's charged.
 */
const CARD: Record<PlanId, { cta: string; buys: string; extras: string[] }> = {
  test_drive: { cta: "Start for $2", buys: "≈ 10 invites, or 30 emails", extras: ["Every channel and the CRM"] },
  start: { cta: "Choose Start", buys: "≈ 20 invites + 40 emails", extras: ["Deliverability report"] },
  grow: {
    cta: "Choose Grow",
    buys: "≈ 40 invites + 100 emails + 3 AI posts",
    extras: ["Lead assignment, roles, team view", "Premium AI models"],
  },
  scale: { cta: "Choose Scale", buys: "≈ 100 invites + 300 emails + 15 AI posts", extras: ["Escalations and SLA rules", "Everything in Grow"] },
};

type Cell = boolean | string | "soon";
type Row = { label: string; soon?: boolean; cell: (p: Plan) => Cell };

const COMPARE: { title: string; rows: Row[] }[] = [
  {
    title: "Capacity",
    rows: [
      { label: "People", cell: (p) => n(p.limits.users) },
      { label: "Sending inboxes", cell: (p) => n(p.limits.inboxes) },
      { label: "Campaigns", cell: (p) => n(p.limits.campaigns) },
      { label: "Templates", cell: (p) => n(p.limits.templates) },
      { label: "Leads stored", cell: (p) => (p.limits.leads === null ? "Unlimited" : n(p.limits.leads)) },
      { label: "Credits a day", cell: (p) => n(p.dailyCredits) },
      { label: "Post autopilots", soon: true, cell: (p) => (p.limits.autopilots ? n(p.limits.autopilots) : false) },
    ],
  },
  {
    title: "What's included",
    rows: [
      { label: "CRM, pipeline and inbox", cell: () => true },
      { label: "Email, LinkedIn, WhatsApp and SMS", cell: () => "Uses credits" },
      { label: "Reports overview", cell: () => true },
      { label: "Deliverability report", cell: (p) => hasFeature(p, "deliverability") },
      { label: "Lead assignment", cell: (p) => (hasFeature(p, "lead_assignment") ? true : p.billing === "monthly" ? "Just you" : false) },
      { label: "Roles: admin and group lead", cell: (p) => hasFeature(p, "roles") },
      { label: "Control tower and ageing reports", cell: (p) => hasFeature(p, "team_reports") },
      { label: "Escalations and SLA rules", cell: (p) => hasFeature(p, "escalations") },
      { label: "Premium AI models", soon: true, cell: (p) => hasFeature(p, "premium_ai_models") },
    ],
  },
  {
    title: "Coming soon",
    rows: [
      { label: "AI calling", cell: (p) => (p.billing === "monthly" ? "soon" : false) },
      { label: "Advanced team performance", cell: (p) => (p.id === "scale" ? "soon" : false) },
      { label: "Priority support", cell: (p) => (p.id === "scale" ? "soon" : false) },
    ],
  },
];

const HOW = [
  {
    title: "They refill every day",
    body: "Your plan's credits reset at midnight in your time zone. Unused ones don't carry over, so one heavy day can't use up your week.",
  },
  {
    title: "You pay when something goes out",
    body: "Credits are taken when an email sends or an invitation is confirmed. A skipped or failed step costs nothing.",
  },
  {
    title: "Enrichment refunds what it can't find",
    body: `If LinkedIn shows no phone number, you get that credit back. If the person isn't a connection yet, you get all ${CREDIT_COSTS.enrich} back.`,
  },
  {
    title: "Top-ups are for busy days",
    body: "For paid plans only. They cost about 3× your plan's rate per credit, and never expire while you're subscribed. They add credits — never seats, inboxes or campaigns.",
  },
];

const COSTS: { label: string; note?: string; credits: number | "Free"; soon?: boolean }[] = [
  { label: "Email sent", credits: CREDIT_COSTS.email_send },
  { label: "LinkedIn invitation", credits: CREDIT_COSTS.li_invite },
  { label: "LinkedIn invitation with a note", credits: CREDIT_COSTS.li_invite_note },
  { label: "LinkedIn message", credits: CREDIT_COSTS.li_message },
  {
    label: "Find email and phone on LinkedIn",
    note: `1 back per missing field · all ${CREDIT_COSTS.enrich} back if not a connection`,
    credits: CREDIT_COSTS.enrich,
    soon: true,
  },
  { label: "WhatsApp or SMS message", note: "On your own number or provider", credits: CREDIT_COSTS.whatsapp_send },
  { label: "AI reply draft", credits: CREDIT_COSTS.ai_draft },
  {
    label: "AI post: find a topic and write it",
    note: `Premium models cost ${CREDIT_COSTS.ai_post_premium}`,
    credits: CREDIT_COSTS.ai_post_standard,
    soon: true,
  },
  { label: "Import from LinkedIn with the extension", note: "Per 10 people", credits: CREDIT_COSTS.li_sourcing },
  { label: "CSV import, adding leads, CRM, inbox, reports", note: "Publishing a post you wrote", credits: "Free" },
];

function Soon() {
  return (
    <span className="ml-2 rounded-full bg-tint px-1.5 py-0.5 align-middle font-mono text-[9px] uppercase tracking-wide text-ink-faint">
      Soon
    </span>
  );
}

function CellView({ cell }: { cell: Cell }) {
  if (cell === true)
    return (
      <>
        <Check className="mx-auto h-4 w-4 text-accent" aria-hidden />
        <span className="sr-only">Included</span>
      </>
    );
  if (cell === false)
    return (
      <>
        <Minus className="mx-auto h-4 w-4 text-ink-faint" aria-hidden />
        <span className="sr-only">Not included</span>
      </>
    );
  if (cell === "soon")
    return (
      <span className="rounded-full bg-tint px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-soft">Coming soon</span>
    );
  return <span className="font-mono text-xs text-ink">{cell}</span>;
}

function TierCard({ plan }: { plan: Plan }) {
  const card = CARD[plan.id];
  const popular = plan.id === POPULAR;
  const l = plan.limits;
  const features = [
    `${plural(l.users, "user")} · ${plural(l.inboxes, "inbox", "inboxes")}`,
    `${plural(l.campaigns, "campaign")} · ${plural(l.templates, "template")}`,
    l.leads === null ? "Unlimited leads" : `${n(l.leads)} leads stored`,
    ...card.extras,
  ];

  return (
    <div
      className={`relative flex flex-col rounded-[24px] border p-6 ${
        popular ? "border-accent bg-accent-soft/40 shadow-xl ring-2 ring-accent/30" : "border-line bg-surface shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-accent">{plan.name}</span>
        {popular && (
          <span className="rounded-full bg-accent px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-white">Most popular</span>
        )}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-4xl font-extrabold">${plan.price}</span>
        <span className="text-sm text-ink-soft">{plan.billing === "one_time" ? `one-time · ${plan.days} days` : "/ month"}</span>
      </div>
      <p className="mt-2 text-sm text-ink-soft">{plan.blurb}</p>

      <div className={`mt-4 rounded-xl p-3 text-xs ${popular ? "bg-surface" : "bg-tint"}`}>
        <div className="text-sm font-semibold text-ink">{n(plan.dailyCredits)} credits a day</div>
        <div className="mt-0.5 text-ink-soft">{card.buys}</div>
        <div className="mt-1 font-semibold text-accent-strong">
          {plan.billing === "one_time"
            ? `${n(periodCredits(plan))} over the ${plan.days} days · no top-ups`
            : `≈ ${n(periodCredits(plan))} a month · $${planCreditRate(plan).toFixed(4)} each`}
        </div>
      </div>

      <ul className="mt-5 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <Check className={`mt-0.5 h-4 w-4 shrink-0 ${popular ? "text-accent" : "text-ink-soft"}`} aria-hidden />
            <span className="text-ink">{f}</span>
          </li>
        ))}
      </ul>

      <Link href={`/sign-up?plan=${plan.id}`} className={`btn mt-6 justify-center ${popular ? "btn-primary" : "btn-ghost"}`}>
        {card.cta}
      </Link>
    </div>
  );
}

export default function PricingPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Pricing"
        title="Pay for the outreach you actually do"
        subtitle={`Every plan has the CRM, the inbox and every channel. Credits refill every day, so one busy Monday never eats the rest of your week. Try it on your own leads for $${PLANS.test_drive.price}.`}
      />

      <section className="bg-canvas pb-16">
        <div className="mx-auto grid max-w-6xl gap-5 px-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS_SHOWN.map((plan) => (
            <TierCard key={plan.id} plan={plan} />
          ))}
        </div>

        <div className="mx-auto mt-6 max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-6 py-5">
            <div className="min-w-0">
              <div className="font-semibold">More than {PLANS.scale.limits.users} people?</div>
              <p className="text-sm text-ink-soft">A custom plan for bigger teams: more seats, higher limits, onboarding and priority support.</p>
            </div>
            <Link href="/contact" className="btn btn-ghost shrink-0">
              Talk to us
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-canvas pb-16">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-display text-3xl font-extrabold">Compare plans</h2>
          {/* `relative` makes this the containing block for the cells' sr-only labels, which are
              absolutely positioned: without it they escape the scroller and widen the whole page. */}
          <div className="relative mt-6 overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <caption className="sr-only">What each plan includes</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-[34%] px-4 py-4 text-left">
                    <span className="sr-only">Feature</span>
                  </th>
                  {PLANS_SHOWN.map((p) => (
                    <th key={p.id} scope="col" className={`px-4 py-4 text-center ${p.id === POPULAR ? "bg-accent-soft/60" : ""}`}>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-accent">{p.name}</div>
                      <div className="mt-0.5 text-sm font-semibold">{p.billing === "one_time" ? `$${p.price} once` : `$${p.price} / mo`}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              {COMPARE.map((section) => (
                <tbody key={section.title}>
                  <tr>
                    <th
                      colSpan={PLANS_SHOWN.length + 1}
                      scope="colgroup"
                      className="bg-tint px-4 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft"
                    >
                      {section.title}
                    </th>
                  </tr>
                  {section.rows.map((row) => (
                    <tr key={row.label} className="border-t border-line">
                      <th scope="row" className="px-4 py-3 text-left font-normal text-ink">
                        {row.label}
                        {row.soon && <Soon />}
                      </th>
                      {PLANS_SHOWN.map((p) => (
                        <td key={p.id} className={`px-4 py-3 text-center ${p.id === POPULAR ? "bg-accent-soft/40" : ""}`}>
                          <CellView cell={row.cell(p)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      <section id="credits" className="scroll-mt-24 bg-canvas pb-16">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 lg:grid-cols-[1fr_1.35fr]">
          <div>
            <h2 className="font-display text-3xl font-extrabold">How credits work</h2>
            <dl className="mt-6 space-y-5">
              {HOW.map((h) => (
                <div key={h.title}>
                  <dt className="font-semibold">{h.title}</dt>
                  <dd className="mt-1 text-sm text-ink-soft">{h.body}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full text-sm">
              <caption className="sr-only">What each action costs in credits</caption>
              <thead>
                <tr className="bg-tint font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                  <th scope="col" className="px-4 py-3 text-left font-medium">Action</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Credits</th>
                </tr>
              </thead>
              <tbody>
                {COSTS.map((c) => (
                  <tr key={c.label} className="border-t border-line">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <div className="text-ink">
                        {c.label}
                        {c.soon && <Soon />}
                      </div>
                      {c.note && <div className="text-xs text-ink-soft">{c.note}</div>}
                    </th>
                    <td className={`px-4 py-3 text-right font-mono ${c.credits === "Free" ? "font-semibold text-success-strong" : "text-ink"}`}>
                      {c.credits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-canvas pb-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-accent/20 bg-accent-soft/50 p-6">
            <div className="min-w-0 max-w-xl">
              <div className="font-semibold">Usage top-ups · for paid plans</div>
              <p className="mt-1 text-sm text-ink-soft">
                About 3× the plan rate per credit, for the odd busy day. Topping up most weeks? The next plan up is cheaper and adds
                seats too.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {TOP_UP_PACKS.map((pack) => (
                <li key={pack.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-center">
                  <div className="font-mono text-sm font-semibold">{n(pack.credits)}</div>
                  <div className="font-mono text-[11px] text-ink-soft">
                    ${pack.price} · ${packCreditRate(pack).toFixed(3)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <FAQ />
      <CTABand
        title={`Not sure which plan? Start with the $${PLANS.test_drive.price} Test Drive.`}
        cta={`Start for $${PLANS.test_drive.price}`}
        href="/sign-up?plan=test_drive"
      />
    </SiteShell>
  );
}

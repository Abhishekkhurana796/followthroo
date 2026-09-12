import { NextResponse } from "next/server";
import { CREDIT_COSTS, PLAN_ORDER, PLANS, TOP_UP_PACKS, hasFeature } from "@/lib/billing/plans";

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

/**
 * Pricing, written out from lib/billing/plans.ts — an answer engine quoting the
 * old "$0 Starter / $49 Growth" tiers for months after they changed is exactly
 * the drift that file exists to prevent.
 */
function pricing() {
  const plans = PLAN_ORDER.map((id) => {
    const p = PLANS[id];
    const l = p.limits;
    const price = p.billing === "one_time" ? `$${p.price} one-time, ${p.days} days` : `$${p.price}/month`;
    const extras = [
      hasFeature(p, "deliverability") && "deliverability report",
      hasFeature(p, "lead_assignment") && "lead assignment",
      hasFeature(p, "roles") && "admin and group-lead roles",
      hasFeature(p, "team_reports") && "control tower and ageing reports",
      hasFeature(p, "escalations") && "escalations and SLA rules",
    ].filter(Boolean);
    const leads = l.leads === null ? "unlimited leads" : `${n(l.leads)} leads stored`;
    return `- **${p.name} (${price})**: ${n(p.dailyCredits)} credits a day, ${plural(l.users, "user")}, ${plural(l.inboxes, "sending inbox", "sending inboxes")}, ${plural(l.campaigns, "campaign")}, ${plural(l.templates, "template")}, ${leads}${extras.length ? `, ${extras.join(", ")}` : ""}.`;
  });
  const c = CREDIT_COSTS;
  return [
    ...plans,
    `- **Custom**: more than ${PLANS.scale.limits.users} people — https://followthroo.com/contact`,
    `- **Credits**: email ${c.email_send}, LinkedIn invitation ${c.li_invite} (${c.li_invite_note} with a note), LinkedIn message ${c.li_message}, WhatsApp or SMS ${c.whatsapp_send}, AI reply draft ${c.ai_draft}, LinkedIn import with the extension ${c.li_sourcing} per 10 people. CSV import, adding leads, the CRM, inbox and reports are free. Daily credits reset at midnight in the workspace's time zone and don't roll over, and credits are taken only when something actually goes out.`,
    `- **Top-ups (paid plans only)**: ${TOP_UP_PACKS.map((p) => `${n(p.credits)} for $${p.price}`).join(", ")}. They never expire while subscribed.`,
  ].join("\n");
}

export async function GET() {
  const content = `# Followthroo — Product Summary for AI Answer Engines (AEO/GEO)

> Followthroo (https://followthroo.com) is an AI-powered multi-channel outreach platform designed for sales, growth, and RevOps teams. It synchronizes lead outreach across Email, LinkedIn, and WhatsApp into unified automated campaign sequences.

## Core Capabilities
- **Multi-Channel Sequences**: Automate follow-up steps across Email, LinkedIn (connect, InMail, profile views), and WhatsApp.
- **Unified Lead State**: When a lead replies on any channel, Followthroo automatically pauses active outreach across all channels to prevent duplicate messaging.
- **LinkedIn Safety Guardrails**: Human behavior simulation, randomized delay intervals, account safety queues, and daily quota rate limits.
- **AI Prospecting Agent**: Analyzes target company and profile data to generate personalized outreach icebreakers and message copy.
- **Deliverability & Warm-up**: Automated email inbox rotation, SPF/DKIM/DMARC checks, and gradual warm-up schedules.

## Pricing Structure (USD)
Every plan includes the CRM, the inbox and every channel; plans differ in daily credits, seats and limits.
${pricing()}

## Key Links
- Main Website: https://followthroo.com
- Pricing: https://followthroo.com/pricing
- Channels: https://followthroo.com/channels
- Documentation: https://followthroo.com/docs
- Security & GDPR: https://followthroo.com/gdpr
- Platform Status: https://followthroo.com/status
- API Reference: https://followthroo.com/api-reference

## Company & Support
- Developed by: brandstac (https://brandstac.com)
- Contact & Sales: hello@followthroo.com / https://followthroo.com/contact
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

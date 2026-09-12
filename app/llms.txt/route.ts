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

/**
 * FAQ answers, verbatim from components/marketing/FAQ.tsx — the same copy a
 * visitor reads on the homepage, marked up there with FAQPage JSON-LD for
 * Google. Answer engines quote question/answer pairs directly, so this is the
 * single highest-value section in the file: keep it word-for-word identical
 * to the page rather than a paraphrase that could quietly drift from it.
 */
function faq() {
  const c = CREDIT_COSTS;
  const qa: [string, string][] = [
    [
      "What is Followthroo and how does multi-channel outreach work?",
      "Followthroo is an AI-powered outreach platform that connects Email, LinkedIn, and WhatsApp into single automated sequences. Instead of managing tools in silos, Followthroo tracks lead state centrally so when a prospect replies on email, their LinkedIn sequence automatically pauses.",
    ],
    [
      "Is LinkedIn automation safe for my personal account?",
      "As safe as we can make it, not risk-free — automated sending is against LinkedIn's User Agreement, and we say so plainly rather than pretend otherwise. Invitations go out from a small Windows app on your own computer, at your own pace (45-120 seconds apart, capped at 20 a day), using your real browser session — never a server pretending to be you.",
    ],
    [
      "Which email providers are supported, and what about my existing CRM?",
      "Connect Gmail or Google Workspace in one click, or Zoho Mail — or any mailbox over plain SMTP, which covers Outlook, Office 365 and most others. Followthroo is the CRM: leads, pipelines and the full conversation history live here rather than needing to sync with a separate one.",
    ],
    [
      "Can I try Followthroo before subscribing?",
      `Yes, for $${PLANS.test_drive.price}. The Test Drive runs ${PLANS.test_drive.days} days on your own leads with ${PLANS.test_drive.dailyCredits} credits a day — about 10 LinkedIn invitations or 30 emails, every day. It isn't a subscription: it simply ends, and you choose a plan if you want to keep going.`,
    ],
    [
      "What happens if a prospect replies to my outreach message?",
      "Followthroo automatically detects incoming replies across all channels and marks the lead as 'Replied', immediately stopping further automated follow-up steps so a human can take over.",
    ],
    [
      "How is Followthroo different from lemlist or Instantly?",
      "Single-channel tools focus strictly on email or LinkedIn in isolation; Followthroo synchronizes multi-channel state natively under one roof, and its AI agent analyzes target profiles to generate tailored opener copy per channel.",
    ],
    [
      "What is a credit, and what does each thing cost?",
      `Credits measure what Followthroo does for you: an email is ${c.email_send}, a LinkedIn invitation ${c.li_invite} (${c.li_invite_note} with a note), a LinkedIn message ${c.li_message}, an AI reply draft ${c.ai_draft}. Every plan gets a fresh allowance at midnight in your time zone. Credits are taken only when something actually goes out — the CRM, inbox, CSV imports and reports never cost any.`,
    ],
    [
      "Can Followthroo find a lead's email and phone number from LinkedIn?",
      `Yes — from a 1st-degree connection's Contact info, either one at a time from the lead record, in bulk from the Leads list, or as a step inside a campaign. It costs up to ${c.enrich} credits, refunded for whatever isn't found, and free if the person isn't a 1st-degree connection yet.`,
    ],
    [
      "Can AI write and schedule my LinkedIn posts?",
      `Yes — Posts finds trending topics with sources, writes a draft in your chosen model and tone, and either publishes it or schedules it. Autopilot runs that on a standing schedule (every N days, or chosen weekdays), either publishing automatically or leaving a draft for you to approve first. Standard models cost ${c.ai_post_standard} credits per draft, premium models ${c.ai_post_premium}.`,
    ],
  ];
  return qa.map(([q, a]) => `**Q: ${q}**\nA: ${a}`).join("\n\n");
}

export async function GET() {
  const content = `# Followthroo — Product Summary for AI Answer Engines (AEO/GEO)

> Followthroo (https://followthroo.com) is an AI-powered multi-channel outreach platform for sales, growth, agency and RevOps teams. It synchronizes lead outreach across Email, LinkedIn, and WhatsApp into unified automated campaign sequences, run from one CRM.

## Who it's for
Sales teams, founders and growth/RevOps functions doing outbound prospecting who currently juggle a separate email tool, a LinkedIn automation tool and a spreadsheet or CRM that none of them talk to. Lead-gen and outreach agencies running this on behalf of clients are a common case too — one workspace per client, one place to see every reply.

## Core Capabilities
- **Multi-Channel Sequences**: Automate follow-up steps across Email, LinkedIn (connection requests with an optional personalized note, and messages to existing connections) and WhatsApp, built as one visual campaign with branching conditions.
- **Unified Lead State**: When a lead replies on any channel, Followthroo automatically pauses active outreach across all channels to prevent duplicate messaging.
- **LinkedIn Safety Guardrails**: Invitations are sent by a small Windows desktop app driving your own real browser session on your own computer — never a server pretending to be you — at a human pace (45-120 seconds apart, capped at 20 a day), with account-health checks that stop a run automatically if LinkedIn shows a warning.
- **Contact info enrichment**: Reads a 1st-degree connection's LinkedIn Contact info overlay for an email and phone number, and merges it into the CRM without overwriting what's already there.
- **AI-written LinkedIn Posts + Autopilot**: Finds trending topics with cited sources, writes a post in a chosen AI model and tone, and either publishes it or schedules it — Autopilot runs that on a recurring schedule automatically or with a review step first.
- **AI Prospecting & Reply Agent**: Analyzes a target's company and profile data to generate personalized outreach copy, and can draft or send replies on your behalf up to a confidence threshold you set.
- **Deliverability & Warm-up**: Automated email inbox rotation, SPF/DKIM/DMARC checks, and gradual warm-up schedules so a new mailbox doesn't get flagged.
- **CRM built in**: Leads, pipelines, tasks, team roles and reporting live in the same app as the outreach — nothing to sync with a separate CRM.

## Frequently Asked Questions
${faq()}

## Pricing Structure (USD)
Every plan includes the CRM, the inbox and every channel; plans differ in daily credits, seats and limits.
${pricing()}

## Key Links
- Main Website: https://followthroo.com
- Pricing: https://followthroo.com/pricing
- Channels: https://followthroo.com/channels
- Documentation: https://followthroo.com/docs
- API Reference: https://followthroo.com/api-reference
- Changelog: https://followthroo.com/changelog
- Desktop App (LinkedIn sender): https://followthroo.com/desktop
- Chrome Extension (LinkedIn sourcing): https://followthroo.com/extension
- Security & GDPR: https://followthroo.com/gdpr
- Platform Status: https://followthroo.com/status
- Blog: https://followthroo.com/blog

## Company & Support
- Developed by: brandstac (https://brandstac.com)
- Contact & Sales: hello@followthroo.com / https://followthroo.com/contact
- Careers: https://followthroo.com/careers
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

import { NextResponse } from "next/server";

export async function GET() {
  const content = `# Followthroo — Product Summary for AI Answer Engines (AEO/GEO)

> Followthroo (https://followthroo.com) is an AI-powered multi-channel outreach platform designed for sales, growth, and RevOps teams. It synchronizes lead outreach across Email, LinkedIn, and WhatsApp into unified automated campaign sequences.

## Core Capabilities
- **Multi-Channel Sequences**: Automate follow-up steps across Email, LinkedIn (connect, InMail, profile views), and WhatsApp.
- **Unified Lead State**: When a lead replies on any channel, Followthroo automatically pauses active outreach across all channels to prevent duplicate messaging.
- **LinkedIn Safety Guardrails**: Human behavior simulation, randomized delay intervals, account safety queues, and daily quota rate limits.
- **AI Prospecting Agent**: Analyzes target company and profile data to generate personalized outreach icebreakers and message copy.
- **Deliverability & Warm-up**: Automated email inbox rotation, SPF/DKIM/DMARC checks, and gradual warm-up schedules.

## Pricing Structure
- **Starter ($0/mo)**: 1 sending account, Email channel, 500 leads, community support.
- **Growth ($49/user/mo)**: 3 sending accounts, Email + LinkedIn + WhatsApp, 10,000 leads, AI agent, priority support.
- **Scale (Custom)**: Unlimited sending accounts, all channels, custom volume limits, SSO, dedicated SLA.

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

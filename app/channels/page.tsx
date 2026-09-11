import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { FeatureGrid, CTABand } from "@/components/site/blocks";
import { Mail, Linkedin, MessageCircle, MessagesSquare } from "lucide-react";

export const metadata = {
  title: "Outreach Channels — Followthroo",
  description: "One inbox for every way to reach a lead — Email, LinkedIn, WhatsApp, and social orchestrated from a single sequence.",
  openGraph: {
    title: "Outreach Channels — Followthroo",
    description: "One inbox for every way to reach a lead — Email, LinkedIn, WhatsApp, and social orchestrated from a single sequence.",
    url: "https://followthroo.com/channels",
  },
};

export default function ChannelsPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Channels"
        title="One inbox for every way to reach a lead"
        subtitle="Email, LinkedIn, WhatsApp, and social — each paced to its own safe limits, all orchestrated from a single sequence."
      />
      <FeatureGrid
        items={[
          { icon: Mail, title: "Email", body: "DKIM-signed and warmed up. Paced to ~40/hour and Gmail's 500–2,000/day so you land in the inbox." },
          { icon: Linkedin, title: "LinkedIn", body: "Humanized invites that start at ~20/day and ramp with acceptance — no robotic bursts." },
          { icon: MessageCircle, title: "WhatsApp", body: "Opt-in aware and template-approved, capped at 250 unique contacts / 24h until you scale up." },
          { icon: MessagesSquare, title: "Social", body: "Drop a comment where the conversation already lives, within each platform's limits." },
        ]}
      />
      <CTABand />
    </SiteShell>
  );
}

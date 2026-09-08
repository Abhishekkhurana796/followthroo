"use client";

import Link from "next/link";
import useSWR from "swr";
import { Mail, Linkedin, MessageCircle, Smartphone, Radio, ArrowRight } from "lucide-react";
import { DashHeader, Badge, Skeleton } from "@/components/ui";

/**
 * Channels — every way of reaching someone, in one place.
 *
 * This exists because the ways of contacting a person were scattered: mailboxes
 * under Settings, LinkedIn on its own rail row, WhatsApp and SMS behind
 * Settings → Business channels. Four things of the same kind in three different
 * places, and no screen that answered "what can I actually send through today?".
 *
 * It is a hub, not a new home. Each card links to wherever that channel is
 * really configured, so nothing moved and nothing is duplicated — what is new is
 * being able to see all four states at once.
 *
 * Lead sources sit here too. They are not a channel — nothing is sent through
 * them — but they are the other half of the same question: how people arrive,
 * as against how you reach them.
 */

type Status = {
  email: { configured: boolean; mailboxes: number };
  linkedin: { configured: boolean; memberName: string | null; lastSeenAt: string | null };
  whatsapp: { configured: boolean; fromMasked: string | null };
  sms: { configured: boolean };
  leadSources: { count: number };
};

type Card = {
  key: string;
  name: string;
  icon: typeof Mail;
  href: string;
  /** The channel's colour from design_constraints.md §1. */
  tint: string;
  blurb: string;
  state: (s: Status) => { label: string; tone: "success" | "neutral" | "warning"; detail: string };
};

const CARDS: Card[] = [
  {
    key: "email",
    name: "Email",
    icon: Mail,
    href: "/dashboard/accounts",
    tint: "#ff5c39",
    blurb: "Your own mailboxes, with warm-up and reply tracking.",
    state: (s) => ({
      label: s.email.configured ? "Connected" : "Not connected",
      tone: s.email.configured ? "success" : "neutral",
      detail: s.email.configured
        ? `${s.email.mailboxes} mailbox${s.email.mailboxes === 1 ? "" : "es"} sending`
        : "Connect a mailbox to start sending",
    }),
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    icon: Linkedin,
    href: "/dashboard/linkedin",
    tint: "#2b4dff",
    blurb: "Find people and send connection requests from your own browser.",
    state: (s) => ({
      label: s.linkedin.configured ? "Connected" : "Not connected",
      tone: s.linkedin.configured ? "success" : "neutral",
      detail: s.linkedin.configured
        ? s.linkedin.memberName
          ? `Signed in as ${s.linkedin.memberName}`
          : "Signed in"
        : "Connect your account to source and send",
    }),
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    icon: MessageCircle,
    href: "/dashboard/settings/channels",
    tint: "#12b76a",
    blurb: "One verified business number for the whole organisation.",
    state: (s) => ({
      label: s.whatsapp.configured ? "Connected" : "Not connected",
      tone: s.whatsapp.configured ? "success" : "neutral",
      detail: s.whatsapp.fromMasked ? `Sending from ${s.whatsapp.fromMasked}` : "No sending number yet",
    }),
  },
  {
    key: "sms",
    name: "SMS",
    icon: Smartphone,
    href: "/dashboard/settings/channels",
    tint: "#7a5af8",
    blurb: "Blocked on DLT registration, which is an external process.",
    state: () => ({
      label: "Not available",
      tone: "warning",
      detail: "Needs DLT registration before anything can send",
    }),
  },
];

export default function ChannelsHub() {
  const { data, isLoading } = useSWR<Status>("/api/channels/status");

  return (
    <>
      <DashHeader
        title="Channels"
        subtitle="Every way of reaching someone, and where your leads come from."
      />

      <div className="mx-auto max-w-4xl space-y-8 p-8">
        {isLoading || !data ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {CARDS.map((c) => {
                const st = c.state(data);
                const Icon = c.icon;
                return (
                  <Link
                    key={c.key}
                    href={c.href}
                    className="group rounded-2xl border border-line bg-surface p-5 transition hover:border-brand/40 hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${c.tint}1a`, color: c.tint }}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>

                    <h2 className="mt-4 font-display text-base font-bold">{c.name}</h2>
                    <p className="mt-1 text-sm text-ink-soft">{c.blurb}</p>
                    <p className="mt-3 text-xs text-ink-faint">{st.detail}</p>

                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink">
                      Open
                      <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Not a channel — the other direction. Kept on this screen because
                "how do people reach me" and "how do I reach them" are one
                question when you are setting things up. */}
            <Link
              href="/dashboard/settings/sources"
              className="group flex items-center gap-4 rounded-2xl border border-line bg-surface p-5 transition hover:border-brand/40 hover:shadow-sm"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-ink">
                <Radio className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-base font-bold">Lead sources</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Where leads arrive from — IndiaMART, Meta Ads, Google Ads, a form, a CSV.
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-lg font-bold">{data.leadSources.count}</p>
                <p className="text-xs text-ink-faint">connected</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition group-hover:translate-x-0.5" />
            </Link>

            <p className="text-xs text-ink-faint">
              A channel is a property of a campaign step, not a place you visit — this screen is for
              connecting and checking them. Sending happens in{" "}
              <Link href="/dashboard/campaigns" className="underline">
                Campaigns
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </>
  );
}

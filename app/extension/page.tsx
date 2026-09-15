import type { Metadata } from "next";
import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { EXTENSION_STORE_URL } from "@/lib/constants";
import { PLANS } from "@/lib/billing/plans";

export const metadata: Metadata = {
  title: "Chrome extension — Followthroo",
  description:
    "Save people from LinkedIn into your CRM from the page you are already looking at. Runs in your own logged-in tab — we never hold your LinkedIn password or session.",
};

const STEPS = [
  {
    n: "1",
    title: "Browse LinkedIn as you normally would",
    body: "A search, a company's people page, a post's likers, a group, an event. Wherever the right people already are.",
  },
  {
    n: "2",
    title: "Tick the ones you want",
    body: "A checkbox appears beside each person and a bar at the top of the list. Pick four, or select the page.",
  },
  {
    n: "3",
    title: "They land in Followthroo",
    body: "Deduplicated against contacts you already have, routed to the right rep by your assignment rules, ready to sequence.",
  },
];

const FACTS = [
  {
    title: "We never hold your LinkedIn login",
    body: "Every comparable tool asks for your session cookie, then browses as you from their servers. One breach of theirs exposes every customer's account. Ours runs in your browser — there is nothing to hand over, and nothing for us to lose.",
  },
  {
    title: "The extension only reads — it never sends",
    body: "It has no way to send an invitation or a message; it does not even ask our servers for one. Sending is a separate Windows app you install deliberately, and it runs on your machine too. Two tools, so the one you leave installed in your browser can only ever read.",
  },
  {
    title: "It only reads what you can already see",
    body: "The same names, headlines and employers on the page in front of you. It reads nothing you are not already permitted to see, and nothing at all unless you ask.",
  },
  {
    title: "Limits are the feature, not the fine print",
    body: "Around 20 invites and 80 messages a day, paced at human intervals. Your account's health is worth more than a bigger number, so the ceilings are enforced by our servers, not just the extension.",
  },
];

const SOURCES = [
  "A people search",
  "Sales Navigator lists",
  "Everyone at a company",
  "Who liked or commented on a post",
  "Members of a group",
  "People registered for an event",
  "Your own connections",
  "A single profile, in full",
];

export default function ExtensionPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Chrome extension"
        title="Add people to your CRM from the page you're already on"
        subtitle="Followthroo for LinkedIn puts a checkbox next to everyone in a search. Tick who you want; they arrive in your pipeline, deduplicated and assigned."
      />

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-line bg-surface p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tint font-display text-sm font-bold">
                {s.n}
              </span>
              <h3 className="mt-4 font-display text-base font-bold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[1fr_360px]">
          <div>
            <h2 className="font-display text-2xl font-extrabold">What it can bring in</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Wherever the people are, the extension reads that page — you never pick a tool or a mode.
            </p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {SOURCES.map((s) => (
                <li key={s} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {s}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-tint/40 p-6">
            <h3 className="font-display text-base font-bold">Install it</h3>
            <ol className="mt-3 space-y-2.5 text-sm text-ink-soft">
              <li>
                <span className="font-medium text-ink">1.</span>{" "}
                <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="underline">
                  Add it from the Chrome Web Store
                </a>
                .
              </li>
              <li>
                <span className="font-medium text-ink">2.</span> Open the extension&apos;s Settings, set App URL to{" "}
                <code>https://app.followthroo.com</code>, then paste the pairing token from Followthroo&apos;s LinkedIn page.
              </li>
              <li>
                <span className="font-medium text-ink">3.</span> Press Connect and stay signed in to LinkedIn in that same browser.
              </li>
            </ol>
            <p className="mt-4 text-xs text-ink-faint">
              Works in Chrome and Edge. You must be signed in to LinkedIn in the same browser — that is the whole point.
            </p>
            <a
              href={EXTENSION_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary mt-5 w-full justify-center text-sm"
            >
              Add to Chrome
            </a>
            <Link href="/sign-up?plan=test_drive" className="btn btn-ghost mt-2 w-full justify-center text-sm">
              Try Followthroo for ${PLANS.test_drive.price}
            </Link>
          </div>
        </div>

        <div className="mt-16">
          <h2 className="font-display text-2xl font-extrabold">How it stays safe</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            LinkedIn accounts get restricted for automation. Most of that risk comes from tools that run on somebody
            else&apos;s servers pretending to be you. This one is built the other way round.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {FACTS.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-6">
                <h3 className="font-display text-base font-bold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-soft">{f.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-ink-soft">
            The full detail of what it accesses is in our{" "}
            <Link href="/extension-privacy" className="underline">
              extension privacy notice
            </Link>
            .
          </p>
        </div>
      </section>
    </SiteShell>
  );
}

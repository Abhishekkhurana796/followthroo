import type { Metadata } from "next";
import Link from "next/link";
import { Download, Laptop, ShieldCheck, MousePointerClick, AlertTriangle } from "lucide-react";
import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { DESKTOP_APP_URL, DESKTOP_APP_VERSION } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Desktop app — Followthroo",
  description:
    "Send your queued LinkedIn invitations from your own Windows computer, at a human pace — your session, your IP, never held on our servers.",
};

const STEPS = [
  {
    n: "1",
    title: "Install and sign in once",
    body: "Sign in with Google, Zoho or your password — the same account you already use. LinkedIn refuses to work inside an embedded browser, so that one step opens your normal one and hands you back.",
  },
  {
    n: "2",
    title: "Queue people in Followthroo",
    body: "Tick them on LinkedIn with the Chrome extension, or build a campaign with a LinkedIn step. Nothing is sent yet — the app just knows who's waiting.",
  },
  {
    n: "3",
    title: "Press Start and keep working",
    body: "It opens its own Chrome window and works through the queue on its own, one invite every 45–120 seconds, up to 20 a day. Every click is a synthesized event inside that one window — your mouse and keyboard stay yours.",
  },
];

const FACTS = [
  {
    icon: ShieldCheck,
    title: "Your LinkedIn login never leaves your computer",
    body: "Running this from our servers would mean holding your session cookie and driving it from a datacenter IP — LinkedIn correlates the two, and a session that jumps continents gets checkpointed within hours. This runs on your own machine, on your own connection, so nothing about your login ever reaches us.",
  },
  {
    icon: AlertTriangle,
    title: "It stops before it becomes a problem",
    body: "Twenty sent, LinkedIn's own weekly-limit wall, three failures in a row, or a sign-in prompt — any of these ends the run and says which one. Pressing Start twice in an afternoon doesn't send forty; the day's count is remembered.",
  },
  {
    icon: MousePointerClick,
    title: "An invitation is never guessed at",
    body: "It only ever acts on the profile's own Connect button, never a stranger's suggested one — and it counts a send only once the page itself confirms it, the button turning to “Pending” or a toast appearing. If it can't find Connect, it stops and says so rather than sending a message instead.",
  },
  {
    icon: Laptop,
    title: "You can keep using your computer",
    body: "The Chrome window it drives says so plainly across the top of every page it visits — that one window is the only thing to leave alone. Everything else on your screen is yours the whole time.",
  },
];

export default function DesktopPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="Desktop app"
        title="Send LinkedIn invitations from your own computer"
        subtitle="A small Windows app that sends your queued connection requests at a human pace — your session, your IP, never held on our servers."
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
            <h2 className="font-display text-2xl font-extrabold">Why a desktop app, not the extension</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-soft">
              LinkedIn's own API has no endpoint for sending a connection request or a message to someone you
              aren't connected to — it only lets you post to your own feed. Sending has to come from a real
              browser with a real, logged-in session, so it runs on the one computer that already has both: yours.
              The Chrome extension still does the finding — reading a search, a profile, a company page — it just
              never sends, so the two can never both reach for the same person.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-tint/40 p-6">
            <h3 className="font-display text-base font-bold">Download</h3>
            {DESKTOP_APP_URL ? (
              <>
                <a href={DESKTOP_APP_URL} className="btn btn-primary mt-4 w-full justify-center text-sm">
                  <Download className="h-4 w-4" /> Download for Windows
                </a>
                <p className="mt-2.5 text-xs text-ink-faint">
                  v{DESKTOP_APP_VERSION} · Windows only · unsigned build — Windows SmartScreen will ask you to
                  confirm the first time
                </p>
              </>
            ) : (
              <p className="mt-4 rounded-lg bg-tint px-3 py-2 text-xs text-ink-soft">
                No download has been published for this deployment yet. Ask whoever runs your Followthroo for the
                file.
              </p>
            )}
            <Link href="/sign-up" className="btn btn-ghost mt-2 w-full justify-center text-sm">
              Get Followthroo free
            </Link>
          </div>
        </div>

        <div className="mt-16">
          <h2 className="font-display text-2xl font-extrabold">Built the honest way round</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Automated sending is against LinkedIn's User Agreement, and the risk is to your account — this app
            exists to make that risk as small as it can be, not to pretend it away.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {FACTS.map((f) => (
              <div key={f.title} className="rounded-2xl border border-line bg-surface p-6">
                <f.icon className="h-5 w-5 text-accent" />
                <h3 className="mt-3 font-display text-base font-bold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-soft">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

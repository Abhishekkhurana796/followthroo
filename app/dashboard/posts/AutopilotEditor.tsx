"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/lib/client";
import { Banner, DashHeader, Input, Label, Panel, Select, Textarea, useConfirm, useToast } from "@/components/ui";
import { POST_MODELS } from "@/lib/posts/models";

type ScheduleType = "every_n_days" | "weekdays";
type Autopilot = {
  id: string;
  name: string;
  query: string;
  hashtags: string[];
  brief: string | null;
  model: string;
  variants: number;
  mode: "auto" | "review";
  schedule: { type: ScheduleType; n?: number; days?: number[]; time: string };
  timezoneOffsetMinutes: number;
  reviewLeadHours: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
};

const WEEKDAYS = [
  { v: 0, label: "Sun" },
  { v: 1, label: "Mon" },
  { v: 2, label: "Tue" },
  { v: 3, label: "Wed" },
  { v: 4, label: "Thu" },
  { v: 5, label: "Fri" },
  { v: 6, label: "Sat" },
];

/** Next 5 run times, computed the same way the server does — a preview, not a promise (server recomputes at save/run time). */
function previewRuns(type: ScheduleType, n: number, days: number[], time: string, offsetMin: number, leadHours: number, mode: "auto" | "review") {
  const [hh, mm] = time.split(":").map(Number);
  const out: Date[] = [];
  let from = new Date();
  for (let i = 0; i < 5; i++) {
    let found: Date | null = null;
    for (let d = 0; d <= 60 && !found; d++) {
      const local = new Date(from.getTime() + offsetMin * 60_000);
      local.setUTCHours(0, 0, 0, 0);
      local.setUTCDate(local.getUTCDate() + d);
      local.setUTCHours(hh || 0, mm || 0, 0, 0);
      const at = new Date(local.getTime() - offsetMin * 60_000);
      if (at <= from) continue;
      if (type === "every_n_days" ? d % Math.max(1, n) === 0 : days.includes(new Date(local).getUTCDay())) found = at;
    }
    if (!found) break;
    out.push(found);
    from = new Date(found.getTime() + 60_000);
  }
  return out.map((d) => new Date(d.getTime() - (mode === "review" ? leadHours * 3_600_000 : 15 * 60_000)));
}

export default function AutopilotEditor({ autopilotId }: { autopilotId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: existing } = useSWR<Autopilot>(autopilotId ? `/api/autopilots/${autopilotId}` : null);

  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [brief, setBrief] = useState("");
  const [model, setModel] = useState(POST_MODELS[0].id);
  const [variants, setVariants] = useState(1);
  const [mode, setMode] = useState<"auto" | "review">("review");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("every_n_days");
  const [n, setN] = useState(1);
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [time, setTime] = useState("17:00");
  const [reviewLeadHours, setReviewLeadHours] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setQuery(existing.query);
    setHashtags(existing.hashtags.join(", "));
    setBrief(existing.brief ?? "");
    setModel(existing.model);
    setVariants(existing.variants);
    setMode(existing.mode);
    setScheduleType(existing.schedule.type);
    setN(existing.schedule.n ?? 1);
    setDays(existing.schedule.days ?? [1, 3, 5]);
    setTime(existing.schedule.time);
    setReviewLeadHours(existing.reviewLeadHours);
  }, [existing]);

  const offsetMin = -new Date().getTimezoneOffset(); // the browser's own offset, used as the default
  const runs = previewRuns(scheduleType, n, days, time, existing?.timezoneOffsetMinutes ?? offsetMin, reviewLeadHours, mode);

  async function save() {
    if (!name.trim() || !query.trim()) return setError("Name and a search query are both required.");
    setSaving(true);
    setError(null);
    const schedule = scheduleType === "every_n_days" ? { type: "every_n_days" as const, n, time } : { type: "weekdays" as const, days, time };
    try {
      if (autopilotId) {
        await api(`/api/autopilots/${autopilotId}`, { method: "PATCH", body: { name, brief: brief || null } });
      } else {
        await api("/api/autopilots", {
          body: {
            name,
            query,
            hashtags: hashtags.split(",").map((h) => h.trim()).filter(Boolean),
            brief: brief || undefined,
            model,
            variants,
            mode,
            schedule,
            timezoneOffsetMinutes: existing?.timezoneOffsetMinutes ?? offsetMin,
            reviewLeadHours,
          },
        });
      }
      router.push("/dashboard/posts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggle() {
    if (!existing) return;
    await api(`/api/autopilots/${existing.id}`, { method: "PATCH", body: { enabled: !existing.enabled } });
    toast(existing.enabled ? "Paused." : "Turned on.", "success");
    router.refresh();
  }

  async function remove() {
    if (!existing) return;
    if (!(await confirm({ title: `Delete "${existing.name}"?`, body: "Drafts it already wrote are kept.", confirmLabel: "Delete", tone: "danger" }))) return;
    await api(`/api/autopilots/${existing.id}`, { method: "DELETE" });
    router.push("/dashboard/posts");
  }

  return (
    <>
      <DashHeader
        title={autopilotId ? "Edit autopilot" : "New autopilot"}
        breadcrumb={
          <div className="mb-1 text-xs text-ink-soft">
            <Link href="/dashboard/posts" className="hover:text-ink">
              Posts
            </Link>{" "}
            / {autopilotId ? "Edit autopilot" : "New autopilot"}
          </div>
        }
        action={
          existing ? (
            <div className="flex gap-2">
              <button onClick={toggle} className="btn btn-ghost !py-2 !text-sm">
                {existing.enabled ? "Pause" : "Turn on"}
              </button>
              <button onClick={remove} className="btn btn-ghost !py-2 !text-sm !text-danger">
                Delete
              </button>
            </div>
          ) : undefined
        }
      />
      <div className="max-w-2xl space-y-5 p-8">
        {error && <Banner kind="error">{error}</Banner>}

        <Panel className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly AI sales tips" />
          </div>
          <div>
            <Label>Search query</Label>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What should it find trending topics about?" disabled={!!autopilotId} />
            <p className="mt-1 text-xs text-ink-soft">Hashtags, brief and schedule can only be set when creating — recreate it to change them.</p>
          </div>
          <div>
            <Label>Hashtags (comma-separated)</Label>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} disabled={!!autopilotId} />
          </div>
          <div>
            <Label>Brief / tone</Label>
            <Textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} />
          </div>
        </Panel>

        <Panel className="space-y-4">
          <div>
            <Label>Model</Label>
            <Select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!autopilotId}>
              {POST_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.tier})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Mode</Label>
            <div role="radiogroup" className="inline-flex gap-0.5 rounded-full bg-tint p-1">
              {(["review", "auto"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  disabled={!!autopilotId}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${mode === m ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
                >
                  {m === "review" ? "Review first" : "Auto-publish"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              {mode === "review"
                ? "A draft is created ahead of the slot and waits for your approval. Left unapproved, that slot is skipped."
                : "Publishes on schedule with no human step — always writes exactly one variant."}
            </p>
          </div>
          {mode === "review" && (
            <div>
              <Label>Variants</Label>
              <Select value={variants} onChange={(e) => setVariants(Number(e.target.value))} disabled={!!autopilotId}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </Select>
            </div>
          )}
        </Panel>

        <Panel className="space-y-4">
          <Label>Schedule</Label>
          <div role="radiogroup" className="inline-flex gap-0.5 rounded-full bg-tint p-1">
            {(["every_n_days", "weekdays"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={scheduleType === t}
                disabled={!!autopilotId}
                onClick={() => setScheduleType(t)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${scheduleType === t ? "bg-surface text-ink shadow-sm" : "text-ink-soft"}`}
              >
                {t === "every_n_days" ? "Every N days" : "Chosen weekdays"}
              </button>
            ))}
          </div>

          {scheduleType === "every_n_days" ? (
            <div className="flex items-center gap-2 text-sm">
              Every <Input type="number" min={1} max={30} value={n} onChange={(e) => setN(Number(e.target.value))} disabled={!!autopilotId} className="!w-16" /> day(s) at
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!!autopilotId} className="!w-28" />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => (
                  <button
                    key={w.v}
                    type="button"
                    disabled={!!autopilotId}
                    onClick={() => setDays((d) => (d.includes(w.v) ? d.filter((x) => x !== w.v) : [...d, w.v]))}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${days.includes(w.v) ? "bg-accent text-on-solid" : "bg-tint text-ink-soft"}`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!!autopilotId} className="!w-28" />
            </div>
          )}

          {mode === "review" && (
            <div>
              <Label>Draft created, hours before the slot</Label>
              <Input type="number" min={1} max={24} value={reviewLeadHours} onChange={(e) => setReviewLeadHours(Number(e.target.value))} className="!w-20" />
            </div>
          )}

          {runs.length > 0 && (
            <div className="rounded-xl bg-tint p-3 text-xs text-ink-soft">
              <div className="font-semibold text-ink">Next 5 {mode === "review" ? "drafts" : "posts"}:</div>
              <ul className="mt-1 space-y-0.5">
                {runs.map((r, i) => (
                  <li key={i}>{r.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <button onClick={save} disabled={saving} className="btn btn-primary disabled:opacity-50">
          {autopilotId ? "Save changes" : "Create autopilot"}
        </button>
      </div>
    </>
  );
}

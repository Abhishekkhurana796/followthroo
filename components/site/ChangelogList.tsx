import type { ChangelogEntry } from "@/lib/changelog-data";

/** The version/date/bullets list, shared by all three changelog pages. */
export default function ChangelogList({ entries }: { entries: ChangelogEntry[] }) {
  return (
    <div className="space-y-10">
      {entries.map((e, i) => (
        // Index in the key, not just product+version: 2.4.1 shipped two
        // separate same-day fixes and got two rows, deliberately.
        <div key={`${e.product}-${e.version}-${i}`} className="flex gap-6">
          <div className="w-24 shrink-0">
            <div className="font-display text-lg font-bold">{e.version}</div>
            <div className="font-mono text-xs text-ink-soft">{e.date}</div>
          </div>
          <ul className="flex-1 list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
            {e.items.map((it) => (
              <li key={it}>{it}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

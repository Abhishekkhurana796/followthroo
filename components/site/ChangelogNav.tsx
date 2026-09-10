"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Three products, three version numbers, three changelogs.
 *
 * This used to be one flat list under the web app's own 0.x number, which is
 * how three Chrome extension patches shipped in a single afternoon each
 * claimed a 0.x bump of their own — a number meant to track the web app,
 * standing in for one it had nothing to do with. Each tab is its product's
 * real version source now: the web app's own history, `desktop/package.json`,
 * `extension/manifest.json`.
 */
const TABS = [
  { href: "/changelog", label: "Web app" },
  { href: "/changelog/desktop", label: "Desktop app" },
  { href: "/changelog/extension", label: "Chrome extension" },
];

export default function ChangelogNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Changelog" className="mx-auto mb-10 flex max-w-3xl gap-1 px-6">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              active ? "bg-ink text-canvas" : "text-ink-soft hover:bg-tint hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

import { NextResponse } from "next/server";
import { DESKTOP_APP_VERSION, desktopInstallerUrl } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * GET /api/desktop/download — always the current Windows installer.
 *
 * The installer used to live at one fixed blob pathname that each release
 * overwrote. That is the obvious design and it is wrong: blob objects are
 * served with a thirty-day cache, so an edge that had seen the old file kept
 * handing it out long after the new one was published. A customer downloading
 * "the latest version" would get last week's, and the bug they reported would
 * still be there after they reinstalled.
 *
 * So the artifacts are immutable — one pathname per version, cached hard and
 * correctly — and this route is the only mutable part. Releasing means bumping
 * DESKTOP_APP_VERSION next to the desktop/package.json bump, in the same
 * commit, and the link never changes.
 *
 * Deliberately not cached: it is a pointer, and a cached pointer recreates the
 * exact problem it exists to solve.
 */
export function GET() {
  return NextResponse.redirect(desktopInstallerUrl(), {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      // Handy for a support conversation: you can see which version a link gave
      // somebody without downloading 80MB of it.
      "X-Followthroo-Desktop-Version": DESKTOP_APP_VERSION,
    },
  });
}

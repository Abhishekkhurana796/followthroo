/**
 * Work out what a LinkedIn URL is, so nobody has to pick a scraper.
 *
 * The obvious design for this feature was a grid of thirteen scrapers to choose
 * from — which is PhantomBuster's own layout, and wrong here twice: it adds
 * thirteen choices before you can do anything, and nobody thinks "I want to run
 * the Company Employees Export phantom". They think "I want the people on this
 * page", and they already have the page open.
 *
 * So the URL is the input and the kind is derived. See docs/linkedin-sourcing-ux.md.
 *
 * Deliberately dependency-free: the Add Lead dialog is a client component and
 * detects as you type, so this cannot reach for prisma.
 */

export const SCRAPE_KINDS = [
  "search_export",
  "profile_scrape",
  "company_scrape",
  "company_employees",
  "post_engagers",
  "group_members",
  "event_guests",
  "connections_export",
  "activity_extract",
] as const;
export type ScrapeKind = (typeof SCRAPE_KINDS)[number];

export interface KindInfo {
  /** What we will fetch, in the person's words — echoed back to confirm. */
  label: string;
  /** One line under it, saying what a row will be. */
  hint: string;
  /**
   * Ceiling per run, from docs/phantombuster.md rather than invented. These are
   * LinkedIn's own limits or the community-safe rate, not our preference.
   */
  maxResults: number;
  /** Sensible starting point, so the field is never blank. */
  defaultResults: number;
  /** Needs admin rights on the page — worth saying before they wait for a failure. */
  requiresAdmin?: boolean;
}

export const KIND_INFO: Record<ScrapeKind, KindInfo> = {
  search_export: {
    label: "People from this search",
    hint: "Name, headline, location, company and profile link for each result.",
    maxResults: 1000, // LinkedIn's own cap on a search
    defaultResults: 100,
  },
  profile_scrape: {
    label: "This person's full profile",
    hint: "Headline, current role, company, location, summary and work history.",
    maxResults: 80, // safe daily rate for profile loads
    defaultResults: 1,
  },
  company_scrape: {
    label: "This company's details",
    hint: "Website, industry, size, headquarters, description and founding year.",
    maxResults: 50,
    defaultResults: 1,
  },
  company_employees: {
    label: "People who work at this company",
    hint: "Name, title, location and profile link for each employee.",
    maxResults: 500,
    defaultResults: 100,
  },
  post_engagers: {
    label: "People who liked or commented on this post",
    hint: "Name, headline, profile link, and what they said.",
    maxResults: 200,
    defaultResults: 100,
  },
  group_members: {
    label: "Members of this group",
    hint: "Name, title and profile link. You must have joined the group.",
    maxResults: 500,
    defaultResults: 100,
  },
  event_guests: {
    label: "People registered for this event",
    hint: "Attendees, who tend to be the highest-intent list on LinkedIn.",
    maxResults: 500,
    defaultResults: 100,
  },
  connections_export: {
    label: "Your own connections",
    hint: "Everyone you are connected to, with their current role and company.",
    maxResults: 5000,
    defaultResults: 500,
  },
  activity_extract: {
    label: "This person's recent posts",
    hint: "What they have been posting about — useful before you write to them.",
    maxResults: 50,
    defaultResults: 20,
  },
};

export interface Detected {
  kind: ScrapeKind;
  /** Normalised URL we will actually open. */
  url: string;
  info: KindInfo;
}

/** Strip tracking noise but keep the query — a search URL IS its query string. */
function normalize(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
    for (const junk of ["trk", "trackingId", "originalSubdomain", "lipi", "licu"]) {
      u.searchParams.delete(junk);
    }
    return u;
  } catch {
    return null;
  }
}

/**
 * Detect the scrape kind, or null when it is not a LinkedIn URL we can read.
 *
 * Order matters: `/company/x/people/` must be tested before `/company/x`, and
 * `/{slug}/recent-activity/` before the bare profile, or the more general
 * pattern swallows the more specific one.
 */
export function detectScrapeKind(raw: string): Detected | null {
  const u = normalize(raw);
  if (!u) return null;
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();

  const as = (kind: ScrapeKind): Detected => ({ kind, url: u.toString(), info: KIND_INFO[kind] });

  // Your own network, before the generic /mynetwork paths.
  if (path.startsWith("/mynetwork/invite-connect/connections")) return as("connections_export");

  // Searches: people search only. A jobs or content search has no contacts in it.
  if (path.startsWith("/search/results/people")) return as("search_export");
  if (path.startsWith("/search/results")) return null;

  // Sales Navigator lead search uses a different host path but the same idea.
  if (path.startsWith("/sales/search/people")) return as("search_export");

  if (/^\/company\/[^/]+\/people/.test(path)) return as("company_employees");
  if (/^\/company\/[^/]+/.test(path)) return as("company_scrape");

  if (/^\/groups\/[^/]+\/members/.test(path)) return as("group_members");
  if (/^\/groups\/[^/]+/.test(path)) return as("group_members");

  if (/^\/events\/[^/]+/.test(path)) return as("event_guests");

  // Posts appear under several shapes depending on where the link was copied.
  if (path.startsWith("/posts/") || path.startsWith("/feed/update/") || path.startsWith("/pulse/")) {
    return as("post_engagers");
  }

  // A profile's activity feed, before the profile itself.
  if (/^\/in\/[^/]+\/recent-activity/.test(path)) return as("activity_extract");
  if (/^\/in\/[^/]+/.test(path)) return as("profile_scrape");

  return null;
}

/** Shown when a URL is not recognised — tells them what does work. */
export const SUPPORTED_HINT =
  "Paste a people search, a profile, a company, a post, a group, an event, or your connections page.";

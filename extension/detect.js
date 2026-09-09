/**
 * What kind of LinkedIn page is this?
 *
 * A deliberate, minimal mirror of `lib/linkedin/detect.ts`. The popup needs to
 * recognise the page you are standing on *before* it can talk to the server, so
 * it cannot ask the server to do it — and an extension cannot import TypeScript.
 *
 * Keep the patterns in step with the TS original. If they drift, the popup
 * offers an action the server then rejects, which is a confusing way to fail.
 * The server is the authority: it re-detects on every request and refuses
 * anything it does not recognise.
 */
const FT_KINDS = {
  search_export: { label: "Import these people", hint: "Everyone in this search" },
  profile_scrape: { label: "Save this person", hint: "Their full profile" },
  company_scrape: { label: "Save this company", hint: "Company details" },
  company_employees: { label: "Import these employees", hint: "Everyone who works here" },
  post_engagers: { label: "Import who engaged", hint: "Everyone who liked or commented" },
  group_members: { label: "Import these members", hint: "The group's member list" },
  event_guests: { label: "Import these attendees", hint: "Everyone registered" },
  connections_export: { label: "Import your connections", hint: "Your whole network" },
  activity_extract: { label: "Read their recent posts", hint: "What they have been posting" },
};

function ftDetect(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();

  const as = (kind) => ({ kind, url: u.toString(), ...FT_KINDS[kind] });

  if (path.startsWith("/mynetwork/invite-connect/connections")) return as("connections_export");
  if (path.startsWith("/search/results/people")) return as("search_export");
  // A jobs or content search has no people in it — better to say nothing than
  // to offer an import that returns zero rows.
  if (path.startsWith("/search/results")) return null;
  if (path.startsWith("/sales/search/people")) return as("search_export");

  // Order matters: the specific path must be tested before the general one.
  if (/^\/company\/[^/]+\/people/.test(path)) return as("company_employees");
  if (/^\/company\/[^/]+/.test(path)) return as("company_scrape");
  if (/^\/groups\/[^/]+/.test(path)) return as("group_members");
  if (/^\/events\/[^/]+/.test(path)) return as("event_guests");
  if (path.startsWith("/posts/") || path.startsWith("/feed/update/") || path.startsWith("/pulse/")) {
    return as("post_engagers");
  }
  if (/^\/in\/[^/]+\/recent-activity/.test(path)) return as("activity_extract");
  if (/^\/in\/[^/]+/.test(path)) return as("profile_scrape");

  return null;
}

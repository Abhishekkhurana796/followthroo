/**
 * Changelog entries, newest first — across three products that used to share
 * one version number.
 *
 * Add an entry in the same change that ships the work — a changelog
 * reconstructed later is a guess, not a record.
 *
 * `version` is that PRODUCT's own real version, not an editorial number:
 * webapp keeps the 0.x sequence this file always used; desktop is
 * `desktop/package.json`; extension is `extension/manifest.json`. Bump the
 * source of truth in the same commit and copy the number here.
 *
 * History before 2026-09-11 was reconstructed from git, not written live —
 * everything through 0.9.x/1.0.0-2.5.1/1.0.0-1.10.2 shared one 0.x number
 * regardless of which product it was actually about. Extension versions
 * below are high-confidence: almost every `extension/manifest.json` bump has
 * a commit message that is nearly the same sentence as its changelog
 * paragraph. Desktop versions from 1.10.0 on are the same; 1.8.0 and 1.9.2
 * are the two closest-fit rather than a confirmed match — several early
 * desktop point releases (1.1.0-1.7.0, 1.9.1) shipped same-day fixes that
 * never got an individual paragraph and so don't appear here at all, which
 * is expected, not a gap.
 */
export type Product = "webapp" | "desktop" | "extension";

export interface ChangelogEntry {
  product: Product;
  version: string;
  date: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    product: "desktop",
    version: "1.15.0",
    date: "Sep 2026",
    items: [
      "Fixed the desktop run failing with an unhelpful fetch failed error after profile enrichment was added; requests now identify the operation and network cause, with retries limited by whether replay is safe",
      "Connection invitations and Profile enrichment are now independent lanes with separate queues and Start buttons, so one can never claim or fail the other",
      "The narrow side panel is now a full-page Automation workspace. The hosted web app remains available as-is, with Web app, Hide this panel, and the left-arrow rail switching between them",
      "Profile enrichment now tries deterministic selectors, LinkedIn's direct Contact info route, and a guarded AI fallback that can only open the profile owner's Contact info control",
    ],
  },
  {
    product: "desktop",
    version: "1.14.1",
    date: "Sep 2026",
    items: [
      "Once invitations are sent for the day (or none are queued), the app now also shows and starts contact-info lookups waiting to run — the Start button reads \"Look up N leads\" instead of staying disabled with nothing queued",
    ],
  },
  {
    product: "webapp",
    version: "0.28.1",
    date: "Sep 2026",
    items: ["Claude Fable 5.1 repriced to 39 credits, to stay above cost on every plan including Scale's cheapest per-credit rate"],
  },
  {
    product: "webapp",
    version: "0.28.0",
    date: "Sep 2026",
    items: [
      "Start, Grow and Scale can now be bought straight from Plans & billing, not just messaged in — Razorpay Checkout, one month at a time, with a reminder before it runs out",
      "Eight more AI models for Posts and Autopilot: Llama 3.3 70B, Qwen3 14B, Qwen3 235B A22B and GLM 5.3 on the standard tier; GPT-5.5, GPT-5.6 Sol and Gemini 3.1 Pro on premium; Claude Fable 5.1 for narrative-heavy writing at its own price",
    ],
  },
  {
    product: "webapp",
    version: "0.27.0",
    date: "Sep 2026",
    items: [
      "llms.txt now covers enrichment and AI Posts/Autopilot (previously missing), adds the homepage FAQ as direct Q&A pairs for answer engines to quote, a \"who it's for\" section, and links to the changelog, desktop app and extension pages",
    ],
  },
  {
    product: "webapp",
    version: "0.26.0",
    date: "Sep 2026",
    items: [
      "Every action that spends credits now shows its cost up front, not just after: the campaign builder's step types and note choices, the LinkedIn invite dialog and bulk actions, Queued invitations' per-row cost, the AI post editor's model picker and Write buttons, autopilot's model picker and a per-run total, and Test emails' Send test button",
    ],
  },
  {
    product: "webapp",
    version: "0.25.0",
    date: "Sep 2026",
    items: [
      "New: Posts, under Automate. Write and schedule a LinkedIn post by hand or with AI — pick a model, find a trending topic with sources, and either save it as a draft or schedule it",
      "Autopilot: a standing job that finds topics on a schedule (every N days, or chosen weekdays) and writes a draft for you to approve, or publishes straight to your feed with no review step",
      "One uploaded image per post. Instagram shows as \"coming soon\", with a Notify me",
      "AI posts cost 10 credits on a standard model, 20 on premium, charged per variant only once it's actually written",
    ],
  },
  {
    product: "webapp",
    version: "0.24.0",
    date: "Sep 2026",
    items: [
      "Find email and phone from a LinkedIn connection's Contact info: a bulk action on the Leads screen, a button on the lead record, a new \"Find email and phone\" campaign step (with a Has email / Has phone condition to branch on), and an optional \"look up contact info when an invitation is accepted\" setting under LinkedIn → Limits",
      "Up to 3 credits per lookup, refunded for whatever LinkedIn doesn't show, and free if the person isn't a 1st-degree connection yet",
      "An existing email or phone on a lead is never overwritten — a different one found on LinkedIn is added beside it, marked \"from LinkedIn\"",
    ],
  },
  {
    product: "desktop",
    version: "1.14.0",
    date: "Sep 2026",
    items: [
      "Once the invite queue is empty or capped for the day, the app now also looks up email and phone for 1st-degree connections waiting on a lookup — paced 6-15 seconds apart, capped at 150 a day, and skipped whenever the invite run stopped for any reason other than running out of things to send",
    ],
  },
  {
    product: "webapp",
    version: "0.23.0",
    date: "Sep 2026",
    items: [
      "Plans & billing takes payment through Razorpay for the $2 Test Drive and for credit top-ups. Credits land as soon as the payment clears, and campaign steps waiting for credits carry on straight away instead of at midnight",
      "Launching a campaign shows the most one lead can cost in credits across the sequence, and how many credits are left today",
      "When more is switched on than your plan includes, \"Choose what stays active\" lets you pick which campaigns, sending inboxes and people stay on. Nothing is deleted: the rest pause or go read-only, and upgrading turns them back on",
      "A report your plan doesn't include shows which plan has it, instead of failing. Inviting past your plan's seats, or giving someone the admin or group lead role on a plan without roles, says why",
      "None of this charges or limits anything until billing is switched on",
    ],
  },
  {
    product: "extension",
    version: "3.1.6",
    date: "Sep 2026",
    items: [
      "When your workspace runs out of credits partway through adding people, the bar says how many weren't added, instead of quietly adding fewer. Running out before anyone goes in shows why, and when credits come back",
    ],
  },
  {
    product: "webapp",
    version: "0.22.0",
    date: "Sep 2026",
    items: [
      "New pricing: a $2 Test Drive for 14 days, then Start at $10, Grow at $20 and Scale at $50 a month. Every plan has the CRM, the inbox and every channel; plans differ in daily credits, people, inboxes, campaigns, templates and leads. The pricing page compares them side by side and lists what every action costs",
      "Plans & billing is rebuilt around it: your plan and how much of each limit you use, today's credits, top-up packs with what each credit costs next to your plan's own rate, and a history of every charge and refund. It used to show three plans nobody could be on",
      "Nothing is charged yet, and nothing you send is counted, until card payments are switched on",
      "The sidebar no longer labels every workspace \"Free\"",
      "The homepage, site navigation, footer and the desktop app and Chrome extension pages no longer say \"Start free\", \"Sign up for free\" or \"No card required\" — they offer the $2 Test Drive instead. The homepage's \"Book a demo\" button now opens the contact page rather than the dashboard",
    ],
  },
  {
    product: "webapp",
    version: "0.21.0",
    date: "Sep 2026",
    items: [
      "Choose which LinkedIn invitations carry a note. A new Queued invitations list on the LinkedIn screen shows who goes out next, with a Note switch and an editable note on every invitation, and how many of today's notes are left",
      "Connection-request steps in a campaign have a new \"Add a note for\" setting: Everyone, Leads I pick (each one waits in Queued invitations until you choose), or No one",
      "Set your LinkedIn account type under Limits. Free accounts get 3 notes a day; once they're used, invitations you chose a note for wait for tomorrow instead of going out without one, and invitations without a note keep sending",
      "LinkedIn's daily limits now reset at midnight in your workspace's time zone. They used to reset at 5:30 in the morning India time",
    ],
  },
  {
    product: "desktop",
    version: "1.13.0",
    date: "Sep 2026",
    items: [
      "Fixed: signing in with Google or Zoho in the Followthroo side of the window opened Chrome, signed Chrome in, and left the app signed out. It now goes through your browser the same way the panel's own Sign in button does, and brings you back signed in",
      "The Up next list shows whether each invitation carries a note, with a switch to turn it on or off, an Edit link to change what it says, and how many notes are left today",
      "When LinkedIn says your free personalised notes are used up, the app leaves that invitation for tomorrow with its note and carries on with the ones that have none. It used to count it as a failure and try the same person again",
      "Recolored to match the web app: navy text, the same blue, and a gradient Start button",
    ],
  },
  {
    product: "webapp",
    version: "0.20.9",
    date: "Sep 2026",
    items: [
      "Inside the Windows app, the sign-in and sign-up pages now offer \"Sign in with Google or Zoho in your browser\" instead of buttons that can't work there. This reaches copies of the app that are already installed, without waiting for an update",
      "Fixed: \"Try signing in again\" after a failed Windows app sign-in finished in the browser and never went back to the app",
    ],
  },
  {
    product: "webapp",
    version: "0.20.8",
    date: "Sep 2026",
    items: [
      "Fixed: the homepage's closing pitch and every page's plain \"Start reaching leads\" band were unreadable in dark mode — white text on what should have been a dark panel, but the panel itself was quietly turning pale since dark mode is exactly when the color it used for its background flips light",
      "The footer's theme switch and \"Built by brandstac\" line are centered now, instead of pinned to opposite edges",
    ],
  },
  {
    product: "webapp",
    version: "0.20.7",
    date: "Sep 2026",
    items: [
      "New footer, on every page: five real columns (Get started, Product, Resources, Company, Legal) instead of four, and a small mark centered on the divider above it",
      "New page for the Windows app at /desktop — what it does, why it isn't the Chrome extension, and the download, in the same place the extension already had its own page",
    ],
  },
  {
    product: "extension",
    version: "3.1.5",
    date: "Sep 2026",
    items: [
      "Recolored to match: navy text and the same blue accent as the rest of Followthroo, in both the in-page bar and the popup/settings pages, in light and dark",
    ],
  },
  {
    product: "webapp",
    version: "0.20.6",
    date: "Sep 2026",
    items: [
      "Fixed: a company's lead count on the Companies list could disagree with its own detail page — \"Mobikonnect\" showing 2 leads on one screen and 3 on the next. The list grouped companies by exact spelling, so \"Mobikonnect\" and \"mobikonnect\" counted as two different companies with two different totals; it now groups the same way the detail page already matched, ignoring case",
      "A company can now be renamed or deleted from its own page. Renaming moves every lead there to the new name; deleting only removes the company from those leads — nobody's contact record is deleted",
      "The Team page now says what each role can actually do, next to every member — not just while inviting someone new",
    ],
  },
  {
    product: "webapp",
    version: "0.20.5",
    date: "Sep 2026",
    items: [
      "Added native Next.js App Router robots generator (/robots.txt) and sitemap generator (/sitemap.xml) to index public marketing pages while disallowing application dashboard/auth endpoints",
    ],
  },
  {
    product: "webapp",
    version: "0.20.4",
    date: "Sep 2026",
    items: [
      "Optimized SEO, AEO, and GEO surface with dynamic OpenGraph image generation (/opengraph-image), plain-text LLM product summary (/llms.txt), and enriched metadata across marketing pages",
    ],
  },
  {
    product: "webapp",
    version: "0.20.3",
    date: "Sep 2026",
    items: [
      "Added interactive FAQ component with live category search and FAQPage JSON-LD schema across the homepage and pricing page",
    ],
  },
  {
    product: "webapp",
    version: "0.20.2",
    date: "Sep 2026",
    items: [
      "Integrated GDPR cookie consent management (ft-consent cookie) and connected Google Analytics 4 tracking (G-SHMQHNSM8D) gated on explicit user opt-in",
    ],
  },
  {
    product: "webapp",
    version: "0.20.1",
    date: "Sep 2026",
    items: [
      "Upgraded top navigation with lemlist-style multi-column Product and Resources mega-menus (@floating-ui/react hover panels), interactive mobile accordions, and a 3-item CTA cluster ('Log in', 'Get a demo', and 'Sign up for free')",
    ],
  },
  {
    product: "webapp",
    version: "0.20.0",
    date: "Sep 2026",
    items: [
      "Redesigned the entire color system with a lemlist-inspired blue and navy theme: navy ink (#213856), slate blue (#566f8f), electric blue brand accents (#316bff), gradient primary buttons, borderless soft-shadow secondary buttons, and a unified blue-node brand mark",
    ],
  },
  {
    product: "extension",
    version: "3.1.4",
    date: "Sep 2026",
    items: [
      "Updated bar mounting scope to target LinkedIn's left search results column container (.scaffold-layout__list, .search-results-container), preventing layout conflicts with 2-column scaffold grids and preview side panes",
    ],
  },
  {
    product: "extension",
    version: "3.1.3",
    date: "Sep 2026",
    items: [
      "Broadened search URL matching so the top bar mounts automatically on all LinkedIn search result views (/search/results/all, /search/results/, etc.), and made the active bar sticky to the top of the viewport when items are selected on scroll",
    ],
  },
  {
    product: "extension",
    version: "3.1.2",
    date: "Sep 2026",
    items: [
      "Fixed profile card parsing and checkbox overlay alignment for LinkedIn search results where cards use top-level link containers",
    ],
  },
  {
    product: "extension",
    version: "3.1.1",
    date: "Sep 2026",
    items: [
      "Fixed the Followthroo bar still landing on top of the first search result on some LinkedIn layouts, with clicks on Add going to the result underneath instead of the button. It no longer tries to insert itself right above the results list — it always sits at the very top of the page's content area instead, which nothing on LinkedIn's side can render over",
    ],
  },
  {
    product: "desktop",
    version: "1.12.0",
    date: "Sep 2026",
    items: [
      "It now updates itself. A new build downloads in the background — never while invitations are sending — and a small “Restart to update” appears in the panel once it's ready. This is the first version that can do this, so anyone on an earlier build still needs to download once by hand from the LinkedIn page; every build after this one keeps itself current",
    ],
  },
  {
    product: "desktop",
    version: "1.11.0",
    date: "Sep 2026",
    items: [
      "Checks your connections list at the start of a run to spot invitations that were accepted",
      "The download on the LinkedIn page now actually serves 1.11.0. It had been built and described here but the link was still pointing at 1.10.2, before connections-list acceptance detection existed",
    ],
  },
  {
    product: "webapp",
    version: "0.19.1",
    date: "Sep 2026",
    items: [
      "Fixed the homepage's animated “live sequence” graphic: the lines connecting each channel to the lead, and two of the three pulsing dots, were invisible — the colors they were drawn in were never actually defined, so the browser quietly fell back to no line at all. The same missing colors affected the rate-limit table further down the page",
      "The security page's contact address is now hello@followthroo.com",
    ],
  },
  {
    product: "webapp",
    version: "0.19.0",
    date: "Sep 2026",
    items: [
      "New accounts created with an email and password now confirm the address before they can sign in: we email a link, and the account opens once it is clicked. This closes a way someone could register another person’s email ahead of them and keep access after the real owner signed in with Google. Google and Zoho sign-ups work as before, and existing accounts are unaffected",
      "Signing in, signing up and requesting confirmation emails are now rate limited, and so are the Chrome extension, the Windows app, lead webhooks, CSV imports and bulk edits—so a runaway script or a leaked key cannot flood a workspace",
      "Tightened database access so your data can only be reached through Followthroo itself, including any tables added in future",
      "Reports load faster for busy workspaces: totals, daily charts and campaign numbers are counted in the database instead of being assembled from every message in the period",
      "Fixed: a tags column in a CSV import was ignored. Tags in the file are now applied to each lead",
      "Tasks now says when a section is showing only its first 200, instead of silently leaving the rest out",
    ],
  },
  {
    product: "webapp",
    version: "0.18.0",
    date: "Sep 2026",
    items: [
      "New Outbox, under Communicate: everything that went out, and what sent it. Messages sent lists every email, WhatsApp and LinkedIn message with the campaign behind it—or the teammate who typed it, or the AI agent. LinkedIn invites follows every connection request from queued to sent to accepted",
      "The Inbox now says where each conversation came from. A reply to a campaign email is marked with that campaign, a message from a known contact that is not a reply says so plainly, and WhatsApp and LinkedIn threads show which campaign last contacted the person",
      "Reports has a LinkedIn section with real numbers: connection requests sent, how many were accepted, the acceptance rate, and how each campaign did. LinkedIn doesn’t announce acceptances, so a request counts as accepted when that person appears in your connections list—the Windows app checks it at the start of a run, at most every six hours, and the Chrome extension reads it whenever you open your Connections page",
      "Replies you type in the Inbox now count as sent messages, so they appear in the Outbox with your name on them",
      "The Inbox no longer stops at 100 conversations: older ones load from the bottom of the list",
      "Fixed: a team member could open a colleague’s Inbox conversation from a direct link. Conversations now follow the same visibility rules as the Inbox list",
    ],
  },
  {
    product: "extension",
    version: "3.1.0",
    date: "Sep 2026",
    items: [
      "The Followthroo bar no longer covers the LinkedIn feed with a “can’t read this page” message—it only appears on pages that list people. It stays above the results instead of sliding over the first person as you scroll, and once it is out of view the F button shows how many people you have ticked",
      "Fixed adding people from your LinkedIn Connections page. Each connection’s photo links to their profile before their name does, and the extension only ever read that first, empty link—so it found every connection and could not read a single name",
      "Every person in a LinkedIn search, on your Connections page and on a profile now shows whether they are already in Followthroo. “In Followthroo” opens the lead, and a profile that is not in Followthroo yet has an Add button right beside the name",
    ],
  },
  {
    product: "webapp",
    version: "0.17.0",
    date: "Sep 2026",
    items: [
      "Fixed: tasks assigned to a teammate never reached them—nothing on their task list and nothing in their notifications. Signing in always opened the oldest workspace on the account, and for anyone who joined a team by invitation that was the empty personal workspace created when they signed up, so the work was sitting one workspace away. Signing in now opens the workspace you last used, or else the team you joined most recently",
      "The notification bell also counts unread notifications waiting in your other workspaces, with a Switch button beside each, so work assigned to you somewhere else can no longer go unnoticed",
      "Campaigns can now be deleted, by owners and admins. Before you confirm, it says what will stop—how many people are partway through the sequence and how many LinkedIn connection requests are still queued. A campaign that has already sent messages leaves your list but stays in the records, so replies and reports can still say which campaign they came from",
      "Fixed: deleting a campaign used to leave its queued LinkedIn connection requests behind, where the desktop app could still send them. Connection requests from a deleted campaign are now cancelled and never sent",
      "Fixed: a team member could edit or delete a lead they were not allowed to open, if they had its link. Editing and deleting now follow the same visibility rules as viewing",
      "The Leads table has an Added by column: who brought each lead in and how—by hand, from a CSV, or from LinkedIn with the extension—or which source sent it, when no person did. Each lead’s own page says the same, with the date",
      "Leads can be assigned one at a time: choose an owner straight from the Owner column, from the lead’s page, or while adding the lead, and the new owner is notified. The Owner column also now shows the owner of leads that are not in a pipeline, which used to read as a dash",
      "Import CSV now shows the columns it understands—an email or a LinkedIn URL is all a row needs, plus name, company, title, phone and tags—with a sample file to start from. Any other column is kept on the lead and can be used in templates, and after an import it lists why any rows were skipped",
      "Archived templates can be found again: Templates has an Archived list, where each one can be restored or deleted permanently",
      "Removed the paste-a-LinkedIn-link importer from the LinkedIn page and from Add Lead. Bring people in from LinkedIn with the Chrome extension, or in bulk with a CSV that has a LinkedIn URL column",
      "People a team member adds with the extension now count as theirs, so they appear in that person’s leads instead of landing unassigned where they could not see them",
    ],
  },
  {
    product: "desktop",
    version: "1.10.2",
    date: "Sep 2026",
    items: [
      "Fixed connection requests failing on profiles where LinkedIn does not put the person’s name in the usual place. The app worked out which buttons belong to the person you are visiting by starting from their name heading—and on those profiles there is no such heading, so it fell back to reading the name out of the web address and then could attribute nothing at all. It would see three buttons saying “More” (one pinned to the top of the screen, the person’s own, and one that expands their About text), correctly refuse to guess between them, and stop",
      "The name is now found wherever it sits on the page, and matched against the web address even when that address runs the name together without punctuation (/in/liannemui against a heading reading “Lianne Mui”). Those two together are what let it pick the person’s own “More” menu and find Connect inside it",
      "On a profile that offers Follow rather than Connect, the request now goes through the person’s own menu instead of giving up—and Follow is still never pressed in place of Connect",
    ],
  },
  {
    product: "desktop",
    version: "1.10.1",
    date: "Sep 2026",
    items: [
      "Fixed: v1.10.0 would not open at all—it stopped on a startup error about a missing file. The installer was built from a list of files written by hand, and two new ones added in that release were never added to the list, so they were left out of the package. The list is now worked out automatically, which is what stops the next new file going missing the same way. If you downloaded v1.10.0, download again—v1.10.1 is the working build",
    ],
  },
  {
    product: "desktop",
    version: "1.10.0",
    date: "Sep 2026",
    items: [
      "Connection requests are now sent by a fixed, predictable procedure rather than left to the assistant to work out click by click. The app already knows which Connect button is the person’s own; from there, opening it, adding the note and pressing Send is not a judgement call, so it is no longer made as one. The assistant is kept in reserve for a profile laid out in a way the procedure does not recognise—and only before anything has been clicked, so a handover can never turn into a second invitation",
      "It will not stand in for Connect with something else. If it cannot find the person’s own Connect—on the card or inside their “More” menu—it stops and says so. Follow is never pressed in its place, a stranger’s Connect is never pressed, and when two Connect buttons cannot be told apart it refuses rather than guess",
      "An invitation counts as sent only when the page confirms it—the button turning to “Pending” or a “sent” notice appearing. Pressing Send and hoping is not enough: if the page does not confirm, the run reports that plainly instead of recording a request that may never have gone",
      "Every outcome now carries a specific reason—already connected, invitation pending, no Connect found, could not confirm the send, wrong profile—so the record shows what actually happened rather than a bare “failed”",
      "Removed a set of shortcuts that could press Connect or Send by matching the word alone, sidestepping the checks that keep an invitation off the wrong person. Every click, including inside the menu and the send dialog, now goes through those checks",
    ],
  },
  {
    product: "desktop",
    version: "1.9.2",
    date: "Sep 2026",
    items: [
      "Fixed the last thing standing between a written invitation and a sent one. The app filled in the note, went to press Send, and stopped — because the button on that dialog says “Send now”, and it would only accept a button whose wording matched to the letter. Near-misses like that are now understood, so an invitation that has been prepared actually goes out",
      "The app now identifies the person’s own Connect button by where it sits on the screen — directly under their name — rather than by how LinkedIn nests the page. On real profiles the nesting gives no usable clue at all: the action row is not inside anything that also holds the name. Geometry is the one signal LinkedIn does not rewrite",
      "Fixed: references to buttons from a previous look at the page were never cleared, so an instruction meant for one control could land on whatever had since taken its place. Every look now starts clean",
      "Aiming at a point on the screen now requires something that is actually a control there. Previously it could settle on the block of text containing that point — which is how a click once landed on an entire profile — and a run that failed printed that whole profile into the log",
    ],
  },
  {
    product: "desktop",
    version: "1.9.0",
    date: "Sep 2026",
    items: [
      "Fixed the reason no connection requests were going out at all. The app could see the Connect button perfectly well — it said so, every time — and then refused to press it. The check that stops it inviting the wrong person works by first establishing which button belongs to the profile you are on, and that step had quietly never once succeeded, so every button looked equally unattributable and none of them could be clicked",
      "A LinkedIn profile shows several Connect buttons: the person’s own, one stuck to the top of the screen as you scroll, and one for each stranger in “People you may know” and “Others named …”. The app now works out which is which from the heading each one sits under, rather than from the page’s nesting, which LinkedIn changes constantly",
      "If it genuinely cannot tell which Connect belongs to the person you asked for, it still refuses — an invitation cannot be recalled. But it now says which buttons it was choosing between and carries on looking, instead of repeating the same refusal until the run gave up on that person",
      "Fixed: a connection request aimed by position on the screen could land on somebody else’s card inside “Others named …”, a section whose heading is the same name as the person you are visiting. That path is now checked the same way every other one is",
      "Each invitation also starts about ten seconds sooner. The app was waiting for a signal that the profile had finished loading, and that signal depended on the same broken step, so it never arrived and every invite sat through the full wait",
    ],
  },
  {
    product: "desktop",
    version: "1.8.0",
    date: "Sep 2026",
    items: [
      "Fixed the reason connection requests were not going out. LinkedIn moved Connect into the “…” menu on most profiles, and the app opened that menu and then stopped — it was looking for a button, and the thing in the menu is not a button. It also only looked for the word “Connect”, when what is written there is “Invite <name> to connect”",
      "Worse, when it could not find Connect it sent the person a message instead — with your connection-request note as the message. That was meant for people you are already connected to, but “already connected” and “I could not find the button” looked identical to it. Now it tells them apart, and if it genuinely cannot find Connect it stops and says so rather than sending something you did not ask for",
      "If someone is already a connection, a connection request is simply skipped. It no longer turns into a direct message unless the campaign step actually asked for one",
      "You can see exactly who is about to be invited. The app lists them by name, job and company before you start, and the button now says “Send 14 invitations” rather than “Start sending”. The same list appears in Leads before you queue anyone",
      "You can use your computer while invites go out. That was always true — the app drives a separate window and never touches your mouse or keyboard — but Chrome slows down windows you are not looking at, which would have stalled a run. Fixed, and the warning now says to leave that one window alone rather than to leave the computer",
      "Fixed: someone who opted out could still be queued for a connection request. They are now excluded everywhere, and shown as opted out in the preview",
      "The desktop app now has the whole of Followthroo in it — leads, campaigns, inbox — beside the sending panel, instead of only the sending panel",
      "Sign in with Google, Zoho or your password from the desktop app. Google refuses to work inside apps like this one, so sign-in opens your normal browser and hands you back",
      "You no longer paste a pairing token. Once you are signed in the app picks it up by itself",
    ],
  },
  {
    product: "desktop",
    version: "1.0.0",
    date: "Sep 2026",
    items: [
      "LinkedIn invitations now go out from a Windows app you install, instead of the Chrome extension. The extension could open the profile and fill the box, but getting it to reliably press Send was a fight we kept losing — Chrome shuts a background extension down when it looks idle, which is most of a run spent waiting between invites",
      "The app opens a Chrome window and works through your queue on its own, one invite every 45–120 seconds, up to 20 a day. You press Start and walk away",
      "It tells you, loudly, not to use the computer while it runs — in the app and on a red bar across the top of every page it visits. Clicking or typing in that window while it works will break the run",
      "It stops early rather than pushing through. Twenty sent, LinkedIn saying you have hit the weekly limit, three failures in a row, or a sign-in prompt all end the run and say which it was",
      "There is a Test run that does everything except press Send, so you can watch it work once before trusting it with real invitations",
      "Pressing Start twice in one afternoon does not send forty. The day's count is remembered",
      "Your LinkedIn login stays on your computer — the app keeps its own browser profile that you sign into once. We never receive your password or session",
    ],
  },
  {
    product: "extension",
    version: "3.0.0",
    date: "Sep 2026",
    items: [
      "Still needed, and still does finding people. It no longer sends, so the two can never both grab the same person and invite them twice — sending moved to the new Windows app",
    ],
  },
  {
    product: "webapp",
    version: "0.12.0",
    date: "Sep 2026",
    items: [
      "Fixed: campaign invitations could be marked “rate-limited” and dropped before they were ever queued. Two separate daily limits were counting the same 20 invites, and one of them counted queueing as sending. Inviting from the Leads screen skipped that counter entirely, so the same people counted once or twice depending on which screen you started from",
    ],
  },
  {
    product: "extension",
    version: "2.5.1",
    date: "Sep 2026",
    items: [
      "Fixed a serious one: could send a connection request to the wrong person. A LinkedIn profile page carries other people’s Connect buttons — “People also viewed” and “More profiles for you” each show a card per person, with a working Connect on it — and it searched the whole page, so it could click a stranger’s. An invitation cannot be quietly recalled",
      "It now only ever acts on the profile’s own card, never the suggestions around it. If that card offers no Connect, it does nothing rather than reach for the nearest one",
      "It also checks it is on the right profile before acting. A renamed or stale LinkedIn link can redirect you to somebody else entirely; that now stops the action and says so, instead of contacting whoever loaded",
      "Fixed: a message could go to the wrong conversation. LinkedIn keeps earlier chats docked at the bottom of the screen, and it typed into the first box it found rather than the window it had just opened",
    ],
  },
  {
    product: "extension",
    version: "2.5.0",
    date: "Sep 2026",
    items: [
      "Fixed the real reason automatic sending did nothing: it could stop permanently. Its timer was armed one beat at a time, and three ordinary situations — paused, not set up, or a draft waiting on you — returned without arming the next one. Hitting any of them killed it silently until Chrome restarted",
      "The timer is now a heartbeat that cannot be lost. Missing one costs a minute rather than the rest of the day",
      "With automatic sending on, it no longer shows you a card asking you to send it yourself — that card was left over from manual mode and told you to do the exact thing you had turned automatic sending on to avoid",
      "Corrected its own wording. It said “we never click Send for you”, which stopped being true the moment automatic sending shipped",
    ],
  },
  {
    product: "extension",
    version: "2.4.1",
    date: "Sep 2026",
    items: [
      "Fixed: automatic sending genuinely did nothing. It opened the profile in a tab and stopped there. The setting was read correctly on the server and then dropped before it was sent to the browser helper, so the helper never knew it was switched on",
      "Fixed: a LinkedIn-only campaign demanded you pick a mailbox before it would save, which suggested connection requests go out through your email. The mailbox field now appears only when the sequence actually sends email",
    ],
  },
  {
    product: "extension",
    version: "2.4.1",
    date: "Sep 2026",
    items: [
      "Send connection requests straight from Leads. Tick the people you want, press Connect on LinkedIn, and they are queued — no campaign to build first",
      "It tells you what will happen before it happens: how many of the people you picked actually have a LinkedIn profile, how many are already queued, and how many fit inside today’s limit",
      "Nobody gets invited twice. An invitation cannot be quietly recalled, so anyone with a request already waiting is skipped rather than sent a second one",
      "Fixed: the “Send automatically” switch never saved. It was a checkbox that opened a confirmation box, so clicking it looked like nothing happened and dismissing the box silently put it back. It is now a proper switch, on the LinkedIn screen rather than hidden inside Limits",
      "Fixed: one unreviewed draft could block the whole queue forever. Fifty-eight invites were stuck behind a single tab nobody confirmed. Drafts now release themselves after 40 minutes, and with automatic sending on they are never created at all",
      "Queued, sent today and failed today are now on the LinkedIn screen instead of hidden behind a collapsed section",
      "New campaign preset: LinkedIn — connect, then follow up. A connection request, then a message three days later",
    ],
  },
  {
    product: "extension",
    version: "2.4.0",
    date: "Sep 2026",
    items: [
      "LinkedIn can now send on its own. Turn on “Send automatically” under LinkedIn → Limits and connection requests and messages go out without you clicking anything",
      "It runs in your own browser, at your own pace — 45–120 seconds apart, under your daily cap. It is off until you turn it on, and there is a Stop everything button that also clears whatever is queued",
      "Worth knowing before you switch it on: automated sending is against LinkedIn’s User Agreement, and the risk is to your account",
      "It confirms rather than assumes. If the Send button is missing, disabled, or the dialog does not close, the action is recorded as failed — never as sent. A CRM that claims you contacted someone you did not is worse than one that admits it failed",
      "Fixed: LinkedIn messages were being cut off at 300 characters. That is the limit on a connection note, not a message",
    ],
  },
  {
    product: "extension",
    version: "2.3.3",
    date: "Sep 2026",
    items: [
      "Fixed: adding people from a LinkedIn search failed with “String must contain at most 200 characters”. One person with a very long job title took the whole batch down with them",
      "Long headlines and titles are now trimmed to fit rather than refused. Losing the end of a job title is a much smaller problem than losing the ten people you just picked",
      "Job title is read more sensibly too — for a headline with no “at Company” in it, we take the role rather than the person’s entire résumé",
    ],
  },
  {
    product: "extension",
    version: "2.3.2",
    date: "Sep 2026",
    items: [
      "Fixed: the extension could not be installed at all. Test files were added in a folder whose name started with an underscore, and Chrome reserves those — it refuses the entire extension rather than skipping the folder. Every fix since then looked broken because the reload that would have picked them up was itself failing",
      "The packaging check now catches that before an upload, instead of passing every other test while the thing cannot load",
    ],
  },
  {
    product: "extension",
    version: "2.3.1",
    date: "Sep 2026",
    items: [
      "Shows which version it is running — in its popup, and at the bottom of the panel on LinkedIn. Chrome keeps serving the old code to tabs that were already open when you reload an extension, so a fixed bug could look unfixed with nothing on screen to say otherwise",
    ],
  },
  {
    product: "extension",
    version: "2.3.0",
    date: "Sep 2026",
    items: [
      "Follows LinkedIn’s own theme. If you use LinkedIn in dark mode, it is no longer a white slab bolted onto a dark page",
      "The bar looks different once you have picked someone — it used to look identical whether you had selected nobody or forty people",
      "The Followthroo button on LinkedIn has a clearer status light, so you can see at a glance whether it is actually connected",
      "Its menu is attached to the button now, with a pointer, instead of floating like a dialog",
      "Row checkboxes sit inside the row instead of hanging off the left edge, where they used to collide with LinkedIn’s layout at some window widths",
      "The popup and settings pages follow your system light or dark setting",
    ],
  },
  {
    product: "webapp",
    version: "0.10.2",
    date: "Sep 2026",
    items: [
      "Dark mode works on the public site. It never did: the theme switch only existed inside the app, so a visitor who prefers dark got a dark page with white panels sitting on it and no way to change either",
      "There is a theme switch in the site footer now — light, dark, or follow your system",
      "Fixed roughly thirty places that were painted white regardless of theme, including the sign-in and sign-up forms, the pricing table, and the contact form",
      "Fixed the ones that were worse than white-on-dark: several dark bands inverted to near-white while their text stayed white, so whole sections were white on white",
      "Fixed the illustration in the hero — the lead avatar’s initials had vanished, and the logo’s hollow circle had gone solid",
      "Checked every public page in both themes rather than assuming: sixteen pages, no remaining contrast failures",
    ],
  },
  {
    product: "webapp",
    version: "0.10.1",
    date: "Sep 2026",
    items: [
      "The LinkedIn screen is one screen now. Paste a URL, see what came back, and check your account — in that order, on one page",
      "Gone: the catalogue of 32 job cards, 19 of them greyed-out things we had not built, under a heading that claimed 35. None of them were buttons. The roadmap lives in our docs now, not in your product",
      "Gone with it: the essay about session cookies that took up half the screen you land on",
      "Your LinkedIn settings and your LinkedIn screen used to be two different pages for one subject. They are one page. The old link still works",
      "Daily limits are folded away until you want them, because you set them once",
      "The sidebar is down from thirteen rows to ten. Companies is reached from Leads, where those companies come from; Test emails from Templates, where the wording it tests lives; and Calendar has stopped promising something that does not exist yet",
    ],
  },
  {
    product: "webapp",
    version: "0.10.0",
    date: "Sep 2026",
    items: [
      "LinkedIn is now a step in a campaign. Pick “LinkedIn connection request” or “LinkedIn message” the same way you pick Email, put them in whatever order you want, and stop thinking about the browser extension",
      "Which one you get is now decided by the step you built, not by a setting buried in the extension’s options page",
      "Connection notes are checked against LinkedIn’s 300-character limit while you build the campaign, counting what your variables could grow to — not after it fails on the one lead with a long company name",
      "Fixed: editing a campaign quietly unpinned any step that was pinned to a specific version of a template. Re-saving a campaign no longer changes what it sends",
      "Fixed: opening a campaign that had a wait or end step and saving it turned those steps into messages. They are now left exactly as they are",
      "Fixed: per-campaign LinkedIn limits never applied to campaign steps at all, because the step never recorded which campaign it came from. If you have restricted the extension to certain campaigns, that setting now works — and takes effect",
      "Fixed: every LinkedIn step was counted twice in reports, once when queued and again when you sent it",
    ],
  },
  {
    product: "extension",
    version: "2.2.0",
    date: "Sep 2026",
    items: [
      "Fixed: picking people on a LinkedIn search added nobody. The bar counted the rows correctly but could not read a single one of them, because LinkedIn renamed the markup its names live in",
      "Company, job title and location were coming through empty for the same reason — so anything using {{company}} in a template was sending a blank",
      "We now read a person by the shape of their row rather than by LinkedIn’s class names, and connection degree is picked up properly",
      "The count on the bar is now the number we can actually add, not the number we can see. A button that says “Add 10” adds 10",
      "And if we ever can’t read a page again, it says “found 10, read none” instead of failing after you click",
    ],
  },
  {
    product: "extension",
    version: "2.1.0",
    date: "Sep 2026",
    items: [
      "Puts a Followthroo button on every LinkedIn page, so you can see at a glance that it is installed and connected. Drag it up or down; it stays where you put it",
      "Click it anywhere: on a profile it saves that person, on a search it adds everyone on the page, and elsewhere it tells you what to open",
      "Fixed the big one: LinkedIn changed the markup of its people search, and we were still looking for the old layout. Searches read as empty when they were full",
      "We now find people by the shape of the page rather than by LinkedIn’s class names, so the next redesign should not break it the same way",
      "And when we genuinely cannot read a page, the bar says so instead of quietly not appearing — with a button that copies the details for a bug report",
    ],
  },
  {
    product: "webapp",
    version: "0.9.7",
    date: "Sep 2026",
    items: [
      "Connect your LinkedIn account. Settings → LinkedIn now opens LinkedIn’s own consent screen — you sign in on linkedin.com, and your name and photo appear on your account. We never see your password",
      "A connected account can post to your LinkedIn feed on a schedule, through LinkedIn’s official API — no browser needed, and it runs whether or not your laptop is on",
      "The LinkedIn settings page now reads as two plain steps — connect your account, then activate it in the browser you prospect from — rather than a token to copy with no explanation of what it was for",
      "It also answers the question everyone asks: why an extension is needed at all when you have connected your account. LinkedIn sells identity and posting; it does not sell search, invitations or messages at any tier, so the sourcing happens in your own browser",
      "LinkedIn connections expire after 60 days. We now tell you a week before, instead of letting you find out through a post that did not go out",
      "Disconnecting deletes the stored tokens outright rather than flagging them as unused",
      "Your LinkedIn tokens are encrypted at rest, like every other credential you give us",
    ],
  },
  {
    product: "extension",
    version: "2.0.0",
    date: "Sep 2026",
    items: [
      "Now works on LinkedIn itself. A checkbox appears beside every person in a search, with a bar at the top — tick who you want and add them to Followthroo without leaving the page",
      "Picked contacts are deduplicated against people you already have, and routed to the right rep by your assignment rules",
      "Shows live progress while it reads a long list, instead of going quiet for minutes",
      "Add every result, not just the page you are on — a LinkedIn search shows about ten people at a time, so the bar now offers the whole set and reads it in the background",
      "New page at followthroo.com/extension explaining what it does, and a separate privacy notice covering exactly what it accesses",
      "Asks for fewer permissions than before — it no longer requests access to your browser tabs, which it never needed",
    ],
  },
  {
    product: "webapp",
    version: "0.9.5",
    date: "Sep 2026",
    items: [
      "Find leads from LinkedIn. Paste a search, a profile, a company, a post, a group, an event or your connections — we work out what the page is, and your own browser reads it",
      "Everything comes back for review before it becomes a contact. People you already have are ticked off for you, so a big list does not quietly create duplicates",
      "Nothing is sent, connected or messaged by this — it only reads pages you can already see, in your own logged-in tab. No password or session leaves your browser",
      "Daily reading limits, so a big list cannot put your LinkedIn account at risk. The dialog tells you what is left before you start",
      "When LinkedIn changes its layout we say so, instead of reporting an empty result and letting you think the search found nobody",
      "Fixed: a LinkedIn invite note longer than 300 characters was silently cut off mid-word when it reached your browser. It is now refused when you write it",
      "LinkedIn now has its own place in the sidebar, with everything it can do in one screen — paste a URL to get people, watch jobs run, and see the full catalogue of 35 jobs",
      "Each job says plainly whether it only reads a page, whether it will fill a box for you to send yourself, or whether it goes through LinkedIn’s official API — because that is what decides the risk to your account",
      "Jobs that are not built yet say what they are waiting on instead of just “coming soon”",
      "Fixed a serious one: an incoming WhatsApp message could be matched to a contact in someone else’s workspace, because the lookup ignored which workspace it belonged to. A reply could land on the wrong company’s contact, and a “stop” could unsubscribe the wrong person",
    ],
  },
  {
    product: "webapp",
    version: "0.9.4",
    date: "Sep 2026",
    items: [
      "Your contacts are yours. A team member now sees only what is assigned to them or added by them — there is no longer a shared pool everyone can browse",
      "The same is now true of tasks. The Tasks screen used to show every task in the workspace, with owner names, to anyone who opened it",
      "Opening a colleague's contact by pasting its link no longer works either — the record and its whole conversation history are gated, not just hidden from the list",
      "New contacts land on a person automatically. Set a rule per source: always one rep, round-robin, or whoever has the fewest open contacts",
      "Assignment now runs everywhere leads arrive — webhooks, CSV imports and contacts you add by hand. Only webhook leads used to get an owner",
      "A CSV import can spread across the team as it loads, one row each in turn, instead of landing in a heap",
      "New Unassigned view for owners, admins and managers, with a count on your dashboard — so a contact nobody was routed to is visible instead of quietly lost",
      "You are told when work lands on you. Assigning a task or a contact now notifies that person straight away — before, the only thing they ever got was a reminder once it was already due",
      "A notification bell in the header, with an unread count. Click through to the task or contact it is about",
      "It stays quiet when it should: nothing for a task you assigned to yourself, nothing for editing a task without reassigning it, and an import that routes 40 contacts to someone sends one message rather than forty",
      "Two new switches in Settings → Notifications for the assignment emails. The in-app bell is always on",
    ],
  },
  {
    product: "webapp",
    version: "0.9.3",
    date: "Sep 2026",
    items: [
      "Invites are emailed now. You no longer have to copy a link and send it yourself — the copy-link button stays as a fallback",
      "Inviting someone as a Manager works. It used to fail with a server error every time, so the only Managers that existed were made directly in the database",
      "Roles are named the way you'd say them: Owner, Admin, Manager, Team member — with a line under each explaining what it means",
      "Contacts have an owner and a creator of their own, so \"who is working this account\" is a fact rather than something the app guessed from the pipeline",
      "Contacts you add by hand are tagged Manual, and CSV imports are tagged CSV, with who added them and when",
      "A new team performance breakdown — contacts, outreach, replies, reply rate and open tasks per person",
      "The Team settings page is no longer readable by team members, who could previously see everyone's department and reporting line",
      "A reply now has to actually be a reply. We match the email thread, not just the sender's address — so when a contact sends you a brand-new question, their sequence keeps running instead of silently stopping",
      "The other half of the same fix: a reply that comes from an assistant, an alias, or deep in a forwarded thread is now recognised, where before it was missed and we kept emailing someone who had already answered",
      "Reply rate per campaign works. It was structurally always zero — replies were recorded without noting which campaign they answered",
      "New inbound mail that is not a campaign reply is counted separately, so nothing disappears from your numbers",
      "Templates can be edited. Until now they could only be created — there was no way to change a word of one after saving it",
      "Editing a template asks what to do about campaigns already running on it: leave them on the wording they were built with, switch one campaign over, or just save a new version. Before, an edit would have silently rewritten every unsent message in every live sequence",
      "Duplicate, archive, preview against a real contact, send yourself a test, and browse the version history of any template",
      "A preview tells you which variables that contact has no value for, so a merge field never goes out blank",
      "Templates warn about wording that trips spam filters",
      "Sign in with Zoho, and connect a Zoho mailbox to send from in one click — no server settings, no app password",
      "Your dashboard is now yours: your contacts, your tasks, your replies. Owners and managers get a team performance table and can switch the whole screen to any one person",
      "Assign contacts to a teammate in bulk, or hand them back to the team pool",
    ],
  },
  {
    product: "webapp",
    version: "0.9.2",
    date: "Sep 2026",
    items: [
      "Mailbox passwords, Google sign-in tokens and DKIM signing keys are now encrypted in the database, under a key we hold outside it. Keys can be rotated without downtime or a maintenance window",
      "Fixed: a workspace's mailbox password could be read by any member of that workspace from the Campaigns screen. It is no longer sent to the browser at all",
      "Connecting or removing a mailbox, and creating or editing a campaign, now require an owner or admin — a team member could previously delete the mailbox everyone sends from",
      "The Twilio and email provider webhooks now verify their signatures. Anyone who knew the address could previously unsubscribe your contacts",
      "Click tracking links are signed, so the redirect in your emails cannot be pointed at somebody else's site",
      "Our Security and Privacy pages now describe what the product actually does, rather than what it intended to",
      "Reports loads noticeably faster — the charts now stream in behind the numbers instead of blocking them, and the logo behind every screen went from 2.2 MB to 15 KB",
    ],
  },
  {
    product: "webapp",
    version: "0.9.1",
    date: "Sep 2026",
    items: [
      "The AI page is now Test emails, and sends to one lead at a time — it used to tick every lead on the page by default, so a single click could message hundreds",
      "Search and pagination when choosing who to send to. Only leads with an email address are offered, since that is what gets sent",
      "Adding a contact that already exists now says so instead of \"Lead added\" — it updates the existing record rather than creating a duplicate, so it stays where it was in your list",
      "Fixed the contact search when creating a task, which never returned any results",
      "Fixed team invites, which failed with a server error for everyone",
      "The AI agent runs through OpenRouter now, so you can choose the model it uses",
    ],
  },
  {
    product: "webapp",
    version: "0.9.0",
    date: "Aug 2026",
    items: [
      "Buy a sending domain and business mailboxes without leaving Followthroo — pick a name, buy it in the store, and we check the mail records against live DNS and connect the mailbox for you",
      "Cold outreach can run on a lookalike domain instead of the one your invoices go out on, so a spam flag never reaches the address your customers already know",
      "Connecting a mailbox no longer means hunting for server settings: we recognise who runs your mail and ask only for the address and password, or connect Google in one click",
      "Tasks can be handed to a teammate, with a real due date, a priority and an instruction — not just a title",
      "A due date now does something. You get an email when a task comes due, and your manager hears about it if it is still open a day later",
      "One morning email at 8am listing what is overdue and what is due today. Nothing arrives on a day with nothing due",
      "Notification preferences save to your account instead of just the browser you set them in",
    ],
  },
  {
    product: "webapp",
    version: "0.8.0",
    date: "Aug 2026",
    items: [
      "Every lead now has a Next Action — and the app works it out for you when you haven't set one",
      "New lead page: one timeline across email, WhatsApp, LinkedIn and stage changes, with notes and tasks beside it",
      "Tasks — Overdue, Today and Upcoming. A follow-up appears on its own when someone replies and nobody has answered",
      "Home became a work queue instead of a scoreboard: what needs you, who replied, what's overdue",
      "Sidebar cut from 18 items to 11 — Deliverability, Ageing, Escalations and Control tower moved under Reports",
      "Contacts are called Leads everywhere, in the menu and on the page",
      "Campaigns and the AI agent now ask which of your mailboxes to send from — outreach always goes out under your own domain, so replies come back to you and your sending reputation is yours alone",
    ],
  },
  {
    product: "webapp",
    version: "0.7.0",
    date: "Aug 2026",
    items: [
      "AI agent runs on Claude and can move pipeline stages, qualify leads, and draft instead of send when unsure",
      "Channels declare what they can do — WhatsApp's 24-hour session window is now enforced, not assumed",
      "Quiet hours respect the contact's own local time, not the workspace's",
      "Tamper-evident compliance ledger: consent and suppression events are hash-chained and exportable",
      "Control tower — every open conversation across channels, attention-first",
      "Scheduled SLA sweep flags work that has gone quiet",
    ],
  },
  {
    product: "webapp",
    version: "0.6.0",
    date: "Aug 2026",
    items: [
      "LinkedIn moved to a human-assisted model — we draft, you send from your own session",
      "One unified conversation per contact across email, LinkedIn and WhatsApp",
      "Department roles: admin → group leader → member, with data scoped to each",
      "Auto-assignment, capture notifications, and escalation up the hierarchy",
      "Lead scoring, source ROI, and a response-time leaderboard",
      "New lead sources: Google Ads, IndiaMART (incl. backfill), JustDial, Sulekha, TradeIndia",
      "Email-parsing fallback for aggregators with no webhook",
    ],
  },
  {
    product: "webapp",
    version: "0.5.0",
    date: "Aug 2026",
    items: [
      "CRM core: identity graph resolves one person across email, phone and LinkedIn",
      "Generic pipeline engine — stages, SLAs, drag-and-drop, reason-on-backward-move",
      "Inbound adapters and a normalised lead-capture path",
      "First-run product tour and a rebuilt dashboard foundation",
      "Settings for lead sources, team hierarchy and pipelines",
      "Split the product app from the marketing site",
    ],
  },
  {
    product: "webapp",
    version: "0.4.0",
    date: "Jul 2026",
    items: [
      "Multi-tenant workspaces with teams, roles and invitations",
      "Conditional campaigns — branch on replied / opened / clicked, stop on reply",
      "Unified inbox with reply capture across mailboxes",
      "Open and click tracking, reports, and a deliverability score per mailbox",
      "Mailbox warm-up that rescues its own mail from spam",
      "Gmail-OAuth accounts send through the Gmail API; scheduling moved to QStash",
    ],
  },
  {
    product: "extension",
    version: "1.0.0",
    date: "Jul 2026",
    items: ["LinkedIn companion Chrome extension with humanized pacing and daily caps"],
  },
  {
    product: "webapp",
    version: "0.3.0",
    date: "Jul 2026",
    items: ["Monochrome brand refresh", "New landing, dashboard, and 404", "Marketing pages for every section"],
  },
  { product: "webapp", version: "0.2.0", date: "Jul 2026", items: ["Renamed to Followthroo", "AI agent on Claude"] },
  {
    product: "webapp",
    version: "0.1.0",
    date: "Jul 2026",
    items: ["Email, WhatsApp, CRM foundations", "Rate limiting + sequences + templates"],
  },
];

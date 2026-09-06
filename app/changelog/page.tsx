import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";

export const metadata = { title: "Changelog — Followthroo" };

/**
 * Newest first. Add an entry in the same change that ships the work — a changelog
 * reconstructed later is a guess, not a record.
 */
const ENTRIES = [
  {
    version: "0.11.3",
    date: "Sep 2026",
    items: [
      "Fixed the real reason automatic sending did nothing: the browser helper could stop permanently. Its timer was armed one beat at a time, and three ordinary situations — paused, not set up, or a draft waiting on you — returned without arming the next one. Hitting any of them killed it silently until Chrome restarted",
      "The timer is now a heartbeat that cannot be lost. Missing one costs a minute rather than the rest of the day",
      "With automatic sending on, the helper no longer shows you a card asking you to send it yourself — that card was left over from manual mode and told you to do the exact thing you had turned automatic sending on to avoid",
      "Corrected the helper’s own wording. It said “we never click Send for you”, which stopped being true the moment automatic sending shipped",
    ],
  },
  {
    version: "0.11.2",
    date: "Sep 2026",
    items: [
      "Fixed: automatic sending genuinely did nothing. It opened the profile in a tab and stopped there. The setting was read correctly on the server and then dropped before it was sent to the browser helper, so the helper never knew it was switched on",
      "Fixed: a LinkedIn-only campaign demanded you pick a mailbox before it would save, which suggested connection requests go out through your email. The mailbox field now appears only when the sequence actually sends email",
    ],
  },
  {
    version: "0.11.1",
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
    version: "0.11.0",
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
    version: "0.10.6",
    date: "Sep 2026",
    items: [
      "Fixed: adding people from a LinkedIn search failed with “String must contain at most 200 characters”. One person with a very long job title took the whole batch down with them",
      "Long headlines and titles are now trimmed to fit rather than refused. Losing the end of a job title is a much smaller problem than losing the ten people you just picked",
      "Job title is read more sensibly too — for a headline with no “at Company” in it, we take the role rather than the person’s entire résumé",
    ],
  },
  {
    version: "0.10.5",
    date: "Sep 2026",
    items: [
      "Fixed: the extension could not be installed at all. Test files were added in a folder whose name started with an underscore, and Chrome reserves those — it refuses the entire extension rather than skipping the folder. Every fix since then looked broken because the reload that would have picked them up was itself failing",
      "The packaging check now catches that before an upload, instead of passing every other test while the thing cannot load",
    ],
  },
  {
    version: "0.10.4",
    date: "Sep 2026",
    items: [
      "The extension shows which version it is running — in its popup, and at the bottom of the panel on LinkedIn. Chrome keeps serving the old code to tabs that were already open when you reload an extension, so a fixed bug could look unfixed with nothing on screen to say otherwise",
    ],
  },
  {
    version: "0.10.3",
    date: "Sep 2026",
    items: [
      "The extension follows LinkedIn’s own theme. If you use LinkedIn in dark mode, it is no longer a white slab bolted onto a dark page",
      "The bar looks different once you have picked someone — it used to look identical whether you had selected nobody or forty people",
      "The Followthroo button on LinkedIn has a clearer status light, so you can see at a glance whether it is actually connected",
      "Its menu is attached to the button now, with a pointer, instead of floating like a dialog",
      "Row checkboxes sit inside the row instead of hanging off the left edge, where they used to collide with LinkedIn’s layout at some window widths",
      "The extension’s own popup and settings pages follow your system light or dark setting",
    ],
  },
  {
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
    version: "0.9.9",
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
    version: "0.9.8",
    date: "Sep 2026",
    items: [
      "The extension now puts a Followthroo button on every LinkedIn page, so you can see at a glance that it is installed and connected. Drag it up or down; it stays where you put it",
      "Click it anywhere: on a profile it saves that person, on a search it adds everyone on the page, and elsewhere it tells you what to open",
      "Fixed the big one: LinkedIn changed the markup of its people search, and we were still looking for the old layout. Searches read as empty when they were full",
      "We now find people by the shape of the page rather than by LinkedIn’s class names, so the next redesign should not break it the same way",
      "And when we genuinely cannot read a page, the bar says so instead of quietly not appearing — with a button that copies the details for a bug report",
    ],
  },
  {
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
    version: "0.9.6",
    date: "Sep 2026",
    items: [
      "The Chrome extension now works on LinkedIn itself. A checkbox appears beside every person in a search, with a bar at the top — tick who you want and add them to Followthroo without leaving the page",
      "Picked contacts are deduplicated against people you already have, and routed to the right rep by your assignment rules",
      "The extension shows live progress while it reads a long list, instead of going quiet for minutes",
      "Add every result, not just the page you are on — a LinkedIn search shows about ten people at a time, so the bar now offers the whole set and reads it in the background",
      "New page at followthroo.com/extension explaining what it does, and a separate privacy notice covering exactly what it accesses",
      "The extension asks for fewer permissions than before — it no longer requests access to your browser tabs, which it never needed",
    ],
  },
  {
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
    version: "0.4.0",
    date: "Jul 2026",
    items: [
      "Multi-tenant workspaces with teams, roles and invitations",
      "Conditional campaigns — branch on replied / opened / clicked, stop on reply",
      "Unified inbox with reply capture across mailboxes",
      "Open and click tracking, reports, and a deliverability score per mailbox",
      "Mailbox warm-up that rescues its own mail from spam",
      "Gmail-OAuth accounts send through the Gmail API; scheduling moved to QStash",
      "LinkedIn companion Chrome extension with humanized pacing and daily caps",
    ],
  },
  { version: "0.3.0", date: "Jul 2026", items: ["Monochrome brand refresh", "New landing, dashboard, and 404", "Marketing pages for every section"] },
  { version: "0.2.0", date: "Jul 2026", items: ["Renamed to Followthroo", "AI agent on Claude"] },
  { version: "0.1.0", date: "Jul 2026", items: ["Email, WhatsApp, CRM foundations", "Rate limiting + sequences + templates"] },
];

export default function ChangelogPage() {
  return (
    <SiteShell>
      <PageHero kicker="Changelog" title="What's new" subtitle="Every release, newest first." />
      <section className="bg-canvas pb-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="space-y-10">
            {ENTRIES.map((e) => (
              <div key={e.version} className="flex gap-6">
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
        </div>
      </section>
    </SiteShell>
  );
}

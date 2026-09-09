# PhantomBuster LinkedIn Automations Directory & Workflow Specifications

This document contains extracted content, workflow details, inputs/outputs, and operational processes for 35 PhantomBuster LinkedIn automations and flows.

---

## Table of Contents
1. [LinkedIn Category Overview](#1-linkedin-category-overview)
2. [LinkedIn Post Commenter & Liker Scraper](#2-linkedin-post-commenter--liker-scraper)
3. [LinkedIn Outreach Flow](#3-linkedin-outreach-flow)
4. [LinkedIn Search to Lead Outreach Flow](#4-linkedin-search-to-lead-outreach-flow)
5. [LinkedIn Company Page Inviter](#5-linkedin-company-page-inviter)
6. [LinkedIn Search Export](#6-linkedin-search-export)
7. [LinkedIn Search to Lead Connection Flow](#7-linkedin-search-to-lead-connection-flow)
8. [LinkedIn Profile Scraper](#8-linkedin-profile-scraper)
9. [LinkedIn Message Sender](#9-linkedin-message-sender)
10. [LinkedIn Profile URL Finder](#10-linkedin-profile-url-finder)
11. [LinkedIn Auto Invitation Accepter](#11-linkedin-auto-invitation-accepter)
12. [LinkedIn Profile Visitor](#12-linkedin-profile-visitor)
13. [LinkedIn Event Inviter](#13-linkedin-event-inviter)
14. [LinkedIn Connections Export](#14-linkedin-connections-export)
15. [LinkedIn Company Scraper](#15-linkedin-company-scraper)
16. [LinkedIn Activity Extractor](#16-linkedin-activity-extractor)
17. [LinkedIn Auto Commenter](#17-linkedin-auto-commenter)
18. [LinkedIn Auto Connect](#18-linkedin-auto-connect)
19. [LinkedIn Auto Connection Remover](#19-linkedin-auto-connection-remover)
20. [LinkedIn Auto Endorser](#20-linkedin-auto-endorser)
21. [LinkedIn Auto Follow](#21-linkedin-auto-follow)
22. [LinkedIn Auto Invitation Withdrawer](#22-linkedin-auto-invitation-withdrawer)
23. [LinkedIn Auto Liker](#23-linkedin-auto-liker)
24. [LinkedIn Auto Poster](#24-linkedin-auto-poster)
25. [LinkedIn Auto Unfollow](#25-linkedin-auto-unfollow)
26. [LinkedIn Company Employees Export](#26-linkedin-company-employees-export)
27. [LinkedIn Company Follower Collector](#27-linkedin-company-follower-collector)
28. [LinkedIn Company URL Finder](#28-linkedin-company-url-finder)
29. [LinkedIn Connections to Emails Flow](#29-linkedin-connections-to-emails-flow)
30. [LinkedIn Event Guests Export](#30-linkedin-event-guests-export)
31. [LinkedIn Group Member Message Sender](#31-linkedin-group-member-message-sender)
32. [LinkedIn Group Members Export](#32-linkedin-group-members-export)
33. [LinkedIn Group Members to Emails Flow](#33-linkedin-group-members-to-emails-flow)
34. [LinkedIn Inbox Scraper](#34-linkedin-inbox-scraper)
35. [LinkedIn Search to Emails Flow](#35-linkedin-search-to-emails-flow)

---

## 1. LinkedIn Category Overview
* **URL:** `https://phantombuster.com/phantombuster?category=linkedin`
* **Overview:** Central hub for all PhantomBuster LinkedIn Automations (Phantoms) and Multi-step Workflows (Flows).
* **Key Automation Categories:**
  * **Lead Generation & Search:** Export users from searches, groups, events, company followers, and post interactions.
  * **Profile & Data Scraping:** Extract complete profile information, company details, posts, activities, and verified professional emails.
  * **Outreach & Network Building:** Send connection requests, personalized direct messages, and automated follow-up sequences.
  * **Engagement & Brand Building:** Auto-like posts, auto-comment, visit profiles, send event/company page invitations, and publish scheduled posts.
  * **Network Maintenance:** Withdraw pending invitations, remove connections, and accept incoming requests.

---

## 2. LinkedIn Post Commenter & Liker Scraper
* **URL:** `https://phantombuster.com/automations/linkedin/5251160215300729/linkedin-post-commenter-and-liker-scraper`
* **Type:** Phantom (1 slot)
* **Overview:** Extracts all users who commented on or liked specific LinkedIn posts.
* **Key Features:**
  * Collects commenter & liker profile URLs, full names, headlines, reaction types, and comment text.
  * Captures timestamp of comments and post permalinks.
  * Supports multiple post URLs via input spreadsheet.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Input Post URL(s) or Google Sheet / CSV URL.
  * Extraction limit per post / per launch (e.g. max 100-200 engagements per run).
* **How It Works:**
  1. Authenticates via session cookie.
  2. Navigates to input LinkedIn post URL(s).
  3. Opens reaction & comment drawers, scrolls down to load engagement data.
  4. Exports structured CSV/JSON file of engaged leads.

---

## 3. LinkedIn Outreach Flow
* **URL:** `https://phantombuster.com/phantombuster/4545709793535249/linkedin-outreach`
* **Type:** Flow (Multi-step pipeline)
* **Overview:** An end-to-end multi-step sequence that extracts leads from a target source, sends personalized connection requests, monitors request acceptance, and sends multi-step follow-up messages.
* **Key Features:**
  * Automated sequence: Lead Input → Connection Request with Variables → Acceptance Tracking → Message 1 → Delay → Message 2.
  * Automatic stop condition when a lead responds.
  * Personalization tags: `#firstName#`, `#company#`, `#jobTitle#`.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Lead Source: Search URL, CSV, or Google Sheet.
  * Connection invitation message template.
  * Follow-up message templates with customizable delays (e.g., 2 days after acceptance).
  * Rate limits (max 20-30 connection requests per day).
* **How It Works:**
  1. Scrapes leads from source.
  2. Sends connection requests with personal note.
  3. Periodically checks connection status.
  4. Triggers follow-up messages to accepted contacts automatically.

---

## 4. LinkedIn Search to Lead Outreach Flow
* **URL:** `https://phantombuster.com/phantombuster/6276867532496207/linkedin-search-to-lead-outreach`
* **Type:** Flow (Multi-step pipeline)
* **Overview:** Combines LinkedIn Search Export, Profile Scraping, Email Discovery, and Multi-channel outreach into a unified automated campaign.
* **Key Features:**
  * Search extraction → Profile enrichment → Email discovery → Automated outreach sequence.
  * Integrates outreach via both LinkedIn messages and email (when email is discovered).
  * Lead dashboard tracking open rates, acceptance rates, and reply tracking.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * LinkedIn Search query URL (Standard or Sales Navigator).
  * Outreach templates (Connection note, LinkedIn follow-ups, and optional Email sequence).
  * Daily execution schedule and rate limits.
* **How It Works:**
  1. Extracts profiles from LinkedIn search.
  2. Scrapes full profile details and finds verified work email address.
  3. Dispatches automated connection requests or emails based on workflow rule.
  4. Stops sequence upon receiving a reply.

---

## 5. LinkedIn Company Page Inviter
* **URL:** `https://phantombuster.com/phantombuster/8522029843786898/linkedin-company-page-inviter`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically invites 1st-degree connections to follow your LinkedIn Company Page.
* **Key Features:**
  * Leverages monthly LinkedIn company page invitation credits automatically.
  * Filters connections by location, industry, or job title before inviting.
  * Prevents re-inviting users who were previously invited.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Target LinkedIn Company Page URL (Must have admin access).
  * List of connection profile URLs (or exports all 1st-degree connections).
  * Limit per launch (e.g., 50 invitations per run / max 250 per month).
* **How It Works:**
  1. Connects session cookie and opens company page invitation modal.
  2. Selects matching 1st-degree connections.
  3. Sends company page follow invites until credits or daily limits are reached.

---

## 6. LinkedIn Search Export
* **URL:** `https://phantombuster.com/phantombuster/3149/linkedin-search-export`
* **Type:** Phantom (1 slot)
* **Overview:** Extracts list of profile URLs, names, titles, and locations from standard LinkedIn or Sales Navigator search results.
* **Key Features:**
  * Scrapes up to 1,000 search results per search query (LinkedIn limit).
  * Extracts Profile URL, Full Name, Headline, Location, Current Company, and Degree of Connection.
  * Supports multiple search URLs processed in batch.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * LinkedIn Search URL or Google Sheet containing multiple search URLs.
  * Number of results to extract per search / per launch.
* **How It Works:**
  1. Accesses the search URL in headless browser.
  2. Iterates through search result pages (pages 1 to 100).
  3. Extracts visible result cards into JSON/CSV output.

---

## 7. LinkedIn Search to Lead Connection Flow
* **URL:** `https://phantombuster.com/phantombuster/2350589230697394/linkedin-search-to-lead-connection`
* **Type:** Flow (Multi-step pipeline)
* **Overview:** Automated workflow that extracts target profiles from a search query and sends connection requests on complete autopilot.
* **Key Features:**
  * Seamless connection between search export and connection requester.
  * Automatic deduplication of previously contacted prospects.
  * Dynamic fallback tags (e.g. fallback if company name is missing).
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * LinkedIn People Search URL.
  * Personal note template with dynamic tags (`#firstName#`, `#currentCompany#`).
  * Daily connection request quota (Recommended: 20 per day).
* **How It Works:**
  1. Extracts profiles from target search URL.
  2. Passes profile URLs into auto-connect step.
  3. Sends personalized connection requests daily within safety thresholds.

---

## 8. LinkedIn Profile Scraper
* **URL:** `https://phantombuster.com/phantombuster/5589386912058181/linkedin-profile-scraper`
* **Type:** Phantom (1 slot)
* **Overview:** Extracts complete profile details from any list of LinkedIn profile URLs, including email addresses, phone numbers, experience, education, skills, and summary.
* **Key Features:**
  * Captures 30+ profile attributes (First/Last name, headline, current title, company name, industry, location, summary, work history, skills, contact info).
  * Integrated Email Discovery service (finds verified professional emails using Dropcontact/Hunter/PhantomBuster credits).
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Profile URL(s) or Google Sheet/CSV URL containing profile links.
  * Email discovery toggle & API keys (optional).
  * Max profiles per run (Recommended: 80 profiles/day).
* **How It Works:**
  1. Loads each target profile URL.
  2. Expands "Contact info", "About", and "Experience" sections.
  3. Runs email discovery algorithm if enabled.
  4. Downloads enriched structured JSON/CSV report.

---

## 9. LinkedIn Message Sender
* **URL:** `https://phantombuster.com/phantombuster/9227/linkedin-message-sender`
* **Type:** Phantom (1 slot)
* **Overview:** Sends personalized direct messages to 1st-degree LinkedIn connections at scale.
* **Key Features:**
  * Dynamic placeholder tags: `#firstName#`, `#lastName#`, `#company#`, `#title#`.
  * Multi-message support (cycles through multiple templates or custom row-by-row messages from a spreadsheet).
  * Tracks sent messages to avoid duplicate outreach.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Profile URLs or Google Sheet link (with optional custom message column).
  * Default message text with tags.
  * Daily launch limits (Max 80 messages per day).
* **How It Works:**
  1. Opens messaging drawer for each targeted 1st-degree connection.
  2. Substitutes custom variables into message text.
  3. Types message with natural delays and sends.

---

## 10. LinkedIn Profile URL Finder
* **URL:** `https://phantombuster.com/phantombuster/4015/linkedin-profile-url-finder`
* **Type:** Phantom (1 slot)
* **Overview:** Finds LinkedIn profile URLs for a list of names and company names using search engines.
* **Key Features:**
  * Uses search engine queries (Google/Bing) to match First Name, Last Name, and Company Name to exact LinkedIn profile URLs.
  * Does not consume LinkedIn account scraping quota.
  * Match accuracy scoring.
* **Inputs & Parameters:**
  * CSV or Google Sheet containing columns: `First Name`, `Last Name`, `Company Name`.
  * Custom query pattern formatting.
* **How It Works:**
  1. Takes name and company list from input file.
  2. Executes search engine queries (`site:linkedin.com/in/ "Name" "Company"`).
  3. Extracts best match LinkedIn profile URL and updates output CSV.

---

## 11. LinkedIn Auto Invitation Accepter
* **URL:** `https://phantombuster.com/phantombuster/2885/linkedin-auto-invitation-accepter`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically accepts incoming connection requests and optionally sends a welcome message.
* **Key Features:**
  * Cleans up pending incoming invitations queue.
  * Triggers immediate welcome message upon acceptance.
  * Filters invitations by mutual connections or keywords.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Optional welcome message text with `#firstName#` variable.
  * Max invitations to accept per launch.
* **How It Works:**
  1. Navigates to LinkedIn invitation manager (`/mynetwork/invitation-manager/`).
  2. Clicks "Accept" on incoming connection requests.
  3. Sends automated welcome note to newly accepted connections.

---

## 12. LinkedIn Profile Visitor
* **URL:** `https://phantombuster.com/phantombuster/3112/linkedin-profile-visitor`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically visits a list of LinkedIn profiles to trigger "Who viewed your profile" notifications and generate warm leads.
* **Key Features:**
  * Increases profile visibility and inbound profile views.
  * Basic profile data extraction during visit.
  * Safe randomized visit pacing.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Profile URLs or Google Sheet URL.
  * Number of profiles to visit per run (Recommended: max 80/day).
* **How It Works:**
  1. Loads target LinkedIn profile pages sequentially.
  2. Pauses on page to simulate genuine human view.
  3. Target user receives push/email notification of your visit.

---

## 13. LinkedIn Event Inviter
* **URL:** `https://phantombuster.com/phantombuster/6130059528224195/linkedin-event-inviter`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically invites 1st-degree connections to attend a specific LinkedIn Event.
* **Key Features:**
  * Boosts LinkedIn Event registration and attendee numbers.
  * Filters connections by industry, location, or job title.
  * Prevents duplicate invitations.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * LinkedIn Event URL.
  * Target profile list or default to all 1st-degree connections.
  * Daily invitation limits (Max 100-200 per day).
* **How It Works:**
  1. Navigates to target LinkedIn Event page.
  2. Opens "Invite connections" dialog.
  3. Selects filtered connections and sends invites.

---

## 14. LinkedIn Connections Export
* **URL:** `https://phantombuster.com/automations/linkedin/12670/linkedin-connections-export`
* **Type:** Phantom (1 slot)
* **Overview:** Exports all 1st-degree connections into a structured CSV database with full profile URLs, names, headlines, and public email addresses.
* **Key Features:**
  * Full backup of your 1st-degree LinkedIn network.
  * Extracts names, profile URLs, job titles, current companies, connected date, and public emails.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Max connections to export (e.g. extract up to 5,000+ connections).
* **How It Works:**
  1. Navigates to `/mynetwork/invite-connect/connections/`.
  2. Scrolls down to retrieve full list of connected members.
  3. Exports full contact table into downloadable CSV/JSON.

---

## 15. LinkedIn Company Scraper
* **URL:** `https://phantombuster.com/phantombuster/3296/linkedin-company-scraper`
* **Type:** Phantom (1 slot)
* **Overview:** Scrapes company details from LinkedIn company pages.
* **Key Features:**
  * Extracts website URL, industry, company size, employee count range, headquarters location, company description, foundation year, and social links.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Company Page URLs or Google Sheet link.
* **How It Works:**
  1. Opens target LinkedIn Company URL.
  2. Scrapes the "About" section and header metadata.
  3. Outputs structured corporate data CSV.

---

## 16. LinkedIn Activity Extractor
* **URL:** `https://phantombuster.com/phantombuster/9136/linkedin-activity-extractor`
* **Type:** Phantom (1 slot)
* **Overview:** Scrapes recent posts, articles, comments, and post engagement metrics published by target LinkedIn profiles or company pages.
* **Key Features:**
  * Collects post content, post permalinks, post dates, reaction counts, comment counts, and media URLs.
  * Enables content research and lead intent tracking.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of LinkedIn Profile URLs or Company Page URLs.
  * Number of recent posts to extract per profile.
* **How It Works:**
  1. Navigates to `/recent-activity/all/` for target user/company.
  2. Scrolls feed and parses post card content and analytics.

---

## 17. LinkedIn Auto Commenter
* **URL:** `https://phantombuster.com/phantombuster/16226/linkedin-auto-commenter`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically posts comments on specific LinkedIn posts.
* **Key Features:**
  * Spreads custom comments across targeted post URLs.
  * Supports spun text/variations to avoid repetitive comments.
  * Increases engagement visibility.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of post URLs and corresponding comment text (or template).
  * Launch limits (Max 10-20 comments per day).
* **How It Works:**
  1. Opens target post URL.
  2. Enters comment in post box and clicks comment button.

---

## 18. LinkedIn Auto Connect
* **URL:** `https://phantombuster.com/phantombuster/2818/linkedin-auto-connect`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically sends connection requests with personalized invitation notes to target profiles.
* **Key Features:**
  * Personalizes message notes with `#firstName#`, `#company#`, etc.
  * Supports email fallback if LinkedIn asks for email before connecting.
  * Safety rate-limit enforcement.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of Profile URLs (CSV or Google Sheet).
  * Connection note message text (max 300 characters).
  * Limit per launch (Recommended: 20/day max).
* **How It Works:**
  1. Navigates to target profile URL.
  2. Clicks "Connect", pastes personalized note, and sends invitation.

---

## 19. LinkedIn Auto Connection Remover
* **URL:** `https://phantombuster.com/phantombuster/7132580939722323/linkedin-auto-connection-remover`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically removes 1st-degree connections matching specific input criteria.
* **Key Features:**
  * Cleans up unwanted or inactive connections from your network.
  * Removes connections based on list input.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of profile URLs to remove.
  * Max removals per run.
* **How It Works:**
  1. Opens target profile page or connection item.
  2. Clicks "More" → "Remove Connection" and confirms removal.

---

## 20. LinkedIn Auto Endorser
* **URL:** `https://phantombuster.com/phantombuster/3611/linkedin-auto-endorser`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically endorses skills on target 1st-degree connection profiles to boost relationship warmth.
* **Key Features:**
  * Endorses top 3 or top 5 skills automatically.
  * Triggers notification to lead ("User endorsed you for X skill").
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of 1st-degree connection profile URLs.
  * Number of skills to endorse per profile.
* **How It Works:**
  1. Visits profile, scrolls to "Skills" section, clicks "Endorse" buttons.

---

## 21. LinkedIn Auto Follow
* **URL:** `https://phantombuster.com/phantombuster/6874/linkedin-auto-follow`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically follows a list of LinkedIn profiles or company pages without sending connection requests.
* **Key Features:**
  * Follows creator accounts, industry leaders, or prospect profiles.
  * Subscribes to updates in main LinkedIn feed.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of profile/company URLs.
  * Daily execution limit.
* **How It Works:**
  1. Opens target profile/company page and clicks "Follow".

---

## 22. LinkedIn Auto Invitation Withdrawer
* **URL:** `https://phantombuster.com/phantombuster/3672/linkedin-auto-invitation-withdrawer`
* **Type:** Phantom (1 slot)
* **Overview:** Withdraws old sent pending connection requests that were not accepted after a specified number of days.
* **Key Features:**
  * Keeps pending invitation count low to preserve account health.
  * Configurable age threshold (e.g. withdraw invites older than 30 days).
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Minimum age of invitations to withdraw (e.g. 14 or 30 days).
  * Max invitations to withdraw per launch.
* **How It Works:**
  1. Checks `/mynetwork/invitation-manager/sent/`.
  2. Withdraws oldest pending requests beyond threshold.

---

## 23. LinkedIn Auto Liker
* **URL:** `https://phantombuster.com/phantombuster/16227/linkedin-auto-liker`
* **Type:** Phantom (1 slot)
* **Overview:** Automatically likes recent posts of target prospects or post URLs.
* **Key Features:**
  * Auto-likes recent posts from a target lead list.
  * Supports reaction types (Like, Celebrate, Support, Love, Insightful).
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Post URLs or profile URLs.
  * Reaction type choice.
* **How It Works:**
  1. Visits post URL or profile recent activity.
  2. Clicks reaction button on latest post.

---

## 24. LinkedIn Auto Poster
* **URL:** `https://phantombuster.com/phantombuster/7415410842242185/linkedin-auto-poster`
* **Type:** Phantom (1 slot)
* **Overview:** Schedules and publishes posts automatically to your personal LinkedIn profile or company page.
* **Key Features:**
  * Supports text, links, and image attachments.
  * Post scheduling queue driven by a spreadsheet.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Google Sheet containing post text, media links, and publication timestamps.
* **How It Works:**
  1. Reads scheduled row from sheet.
  2. Opens post creation box and publishes post.
* **Our implementation (built 2026-09-04):** `lib/linkedin/post.ts`. The only job in this
  catalogue with a fully official path — LinkedIn sells `w_member_social`, so we post
  through `api.linkedin.com/rest/posts` on a member's consented OAuth token. No session
  cookie, no browser, no extension, and it runs whether or not the member's laptop is on.
  Requires a connected LinkedIn account (Settings → LinkedIn); see `docs/channels.md`.
  Text-only for now: images and documents need a separate upload-then-reference flow, and a
  post that silently loses its attachment is worse than one we have not shipped yet.

---

## 25. LinkedIn Auto Unfollow
* **URL:** `https://phantombuster.com/phantombuster/1942869543072163/linkedin-auto-unfollow`
* **Type:** Phantom (1 slot)
* **Overview:** Unfollows connections or pages to clean up clutter from your LinkedIn main feed while retaining connection status.
* **Key Features:**
  * Unfollows leads/connections while remaining 1st-degree connected.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * List of profiles to unfollow.
* **How It Works:**
  1. Visits profile and toggles "Following" to "Unfollow".

---

## 26. LinkedIn Company Employees Export
* **URL:** `https://phantombuster.com/phantombuster/3295/linkedin-company-employees-export`
* **Type:** Phantom (1 slot)
* **Overview:** Extracts list of employees working at target company pages.
* **Key Features:**
  * Scrapes employee profile URLs, names, titles, and locations.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Company Page URLs.
* **How It Works:**
  1. Opens company page, clicks "View all employees".
  2. Scrapes employee search result list into CSV.

---

## 27. LinkedIn Company Follower Collector
* **URL:** `https://phantombuster.com/phantombuster/6609751279582074/linkedin-company-follower-collector`
* **Type:** Phantom (1 slot)
* **Overview:** Scrapes list of followers of your LinkedIn Company Page.
* **Key Features:**
  * Collects profile details of users following your company.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie (Admin access required).
  * Company Page URL.
* **How It Works:**
  1. Opens Admin Analytics → Followers section.
  2. Scrapes follower table into downloadable list.

---

## 28. LinkedIn Company URL Finder
* **URL:** `https://phantombuster.com/phantombuster/4372/linkedin-company-url-finder`
* **Type:** Phantom (1 slot)
* **Overview:** Finds LinkedIn Company Page URLs for a list of company names using search engines.
* **Key Features:**
  * Converts company name lists into exact LinkedIn company page links.
* **Inputs & Parameters:**
  * CSV/Google Sheet with company names.
* **How It Works:**
  1. Searches web for `site:linkedin.com/company/ "Company Name"`.
  2. Extracts top matching company profile URL.

---

## 29. LinkedIn Connections to Emails Flow
* **URL:** `https://phantombuster.com/phantombuster/2220776630920718/linkedin-connections-to-emails`
* **Type:** Flow (Multi-step pipeline)
* **Overview:** Exports 1st-degree connections and runs email discovery to capture professional email addresses.
* **Key Features:**
  * Automated pipeline: Connections Export → Profile Scraper → Email Discovery.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Email discovery service configuration.
* **How It Works:**
  1. Scrapes all 1st-degree connections.
  2. Finds verified professional email for each connection.

---

## 30. LinkedIn Event Guests Export
* **URL:** `https://phantombuster.com/phantombuster/5447892918325546/linkedin-event-guests-export`
* **Type:** Phantom (1 slot)
* **Overview:** Extracts list of attendees registered for any public or joined LinkedIn Event.
* **Key Features:**
  * Scrapes profiles of high-intent event attendees.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Event URL.
* **How It Works:**
  1. Joins event and opens "Attendees" list.
  2. Scrapes attendee list cards into CSV.

---

## 31. LinkedIn Group Member Message Sender
* **URL:** `https://phantombuster.com/phantombuster/511865799449120/linkedin-group-member-message-sender`
* **Type:** Phantom (1 slot)
* **Overview:** Sends direct messages to fellow members of shared LinkedIn Groups without needing to connect first (bypasses 3rd-degree connection restriction).
* **Key Features:**
  * Sends free group messages to 2nd & 3rd degree members.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Group URL & list of target member profile URLs.
  * Message template with variables.
* **How It Works:**
  1. Opens group member drawer and sends direct group message.

---

## 32. LinkedIn Group Members Export
* **URL:** `https://phantombuster.com/phantombuster/2852/linkedin-group-members-export`
* **Type:** Phantom (1 slot)
* **Overview:** Scrapes full member list of a LinkedIn Group you have joined.
* **Key Features:**
  * Exports profile URLs, names, titles of group members.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * LinkedIn Group URL.
* **How It Works:**
  1. Opens group members page and scrolls down to scrape member list.

---

## 33. LinkedIn Group Members to Emails Flow
* **URL:** `https://phantombuster.com/phantombuster/1960014583069690/linkedin-group-members-to-emails`
* **Type:** Flow (Multi-step pipeline)
* **Overview:** Extracts group members and finds verified work email addresses.
* **Key Features:**
  * Group Members Export → Profile Scraper → Email Discovery pipeline.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Group URL.
  * Email discovery configuration.
* **How It Works:**
  1. Scrapes members of target group and discovers work emails.

---

## 34. LinkedIn Inbox Scraper
* **URL:** `https://phantombuster.com/phantombuster/532696507966746/linkedin-inbox-scraper`
* **Type:** Phantom (1 slot)
* **Overview:** Scrapes conversation history, messages, and response statuses from your LinkedIn messaging inbox.
* **Key Features:**
  * Backup messaging history and sync replies to CRM.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Message count threshold per conversation.
* **How It Works:**
  1. Navigates to inbox, scrolls thread history, and exports text logs.

---

## 35. LinkedIn Search to Emails Flow
* **URL:** `https://phantombuster.com/phantombuster/6546459929405349/linkedin-search-to-emails`
* **Type:** Flow (Multi-step pipeline)
* **Overview:** Extracts leads from standard LinkedIn search results and finds verified professional work email addresses.
* **Key Features:**
  * Search Export → Profile Scraper → Email Discovery automated pipeline.
  * Exports 28+ enriched fields including verified work email.
* **Inputs & Parameters:**
  * LinkedIn Session Cookie.
  * Standard LinkedIn search query URL.
  * Email discovery credit option selection.
* **How It Works:**
  1. Scrapes profile URLs from search results.
  2. Enriches profiles and discovers verified work email address.
  3. Exports structured prospect list into CSV/JSON or CRM sync.

---

## How this maps onto Followthroo

Reference spec for Phase C. Two things stand out on reading the whole catalogue.

**Every single Phantom lists "LinkedIn Session Cookie" as a required input.**
That is the whole security model of the product: you hand PhantomBuster a live
session token and their servers browse as you. Followthroo's extension runs
inside the rep's own logged-in tab, so there is no cookie to hand over and none
to store — which removes the single most sensitive input the entire catalogue
depends on, and with it the breach where one database leak exposes every
customer's LinkedIn account at once. See `extension/README.md`.

**Two of them never touch LinkedIn at all.** Profile URL Finder and Company URL
Finder work by searching the open web for `site:linkedin.com/...`, so they need
no session, no extension, and can run server-side like any other enrichment.

Recommended ceilings, taken from the entries above and worth honouring in
`LinkedInAccount`: ~20-30 connection requests/day, ~80 profiles/day, 100-200
post engagements per run, 1,000 search results per query (LinkedIn's own cap).

Email addresses are **not** scraped. Profile Scraper and the three "to Emails"
flows call a separate discovery service (Dropcontact / Hunter) on credits —
so "search to email outreach" is two products, not one, and needs an
enrichment vendor decision before it can be built.

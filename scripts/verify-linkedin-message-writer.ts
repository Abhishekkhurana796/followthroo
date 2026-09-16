/**
 * The AI LinkedIn message writer's rules, without a model or a database write.
 *
 *   npx tsx --env-file=.env scripts/verify-linkedin-message-writer.ts
 *
 * What is checked is what can go wrong quietly: the model being shown facts that
 * aren't on the record (or private ones that are), a reply going out with its
 * preamble, quote marks, reasoning or a template placeholder still in it, and a
 * campaign step sending the wrong text.
 */
import { cleanMessage, leadFactsText, messagePrompt } from "../lib/linkedin/message-writer";
import { stepNote } from "../lib/channels/linkedin";
import { LINKEDIN_MESSAGE_MAX } from "../lib/linkedin/note";

let pass = 0;
let fail = 0;
const ok = (condition: boolean, message: string, extra = "") => {
  if (condition) pass++;
  else fail++;
  console.log(condition ? "  ok  " : "  FAIL", message, extra);
};

console.log("\n— facts shown to the model —");
const facts = leadFactsText({
  firstName: "Sumeet",
  lastName: "Joon",
  title: "Enterprise Sales",
  company: "Salesforce",
  tags: ["fintech", " "],
  custom: { Industry: "Fintech", Location: "Delhi", "Work Email": "s@x.com", Phone: "+91 99999", linkedin_url: "https://x", Empty: "" },
  notes: ["Met at the BFSI roundtable,   interested in lead routing.", "Second note", "Third note", "Fourth note is dropped"],
  connectedSince: "Sep 11, 2026",
});
ok(facts.includes("Name: Sumeet Joon"), "includes the name");
ok(facts.includes("Job title: Enterprise Sales") && facts.includes("Company: Salesforce"), "includes title and company");
ok(facts.includes("Industry: Fintech") && facts.includes("Location: Delhi"), "includes descriptive custom columns");
ok(!/s@x\.com|\+91|https:\/\/x/.test(facts), "never shows email, phone or links from custom columns", facts.split("\n").filter((l) => /mail|phone|link/i.test(l)).join(" | "));
ok(!facts.includes("Empty:") && !/\bnull\b|\bundefined\b/.test(facts), "skips empty and missing values");
ok(facts.includes("Met at the BFSI roundtable, interested in lead routing.") && !facts.includes("Fourth note"), "includes at most three notes, whitespace tidied");
ok(facts.includes("Connected on LinkedIn since: Sep 11, 2026"), "includes the enrichment's connected-since date");

const bare = leadFactsText({ firstName: null, lastName: null, title: null, company: null, tags: [], custom: {}, notes: [], connectedSince: null });
ok(bare === "", "a lead with nothing on record yields no facts at all");
const { system, user } = messagePrompt(bare, "Lakshay");
ok(user.includes("Nothing beyond their LinkedIn profile."), "and the model is told so, rather than left to fill the gap");
ok(/Use ONLY the facts provided/.test(system) && /Never invent/.test(system), "the prompt forbids invented facts");
ok(/no placeholders/i.test(system) && /no emojis/i.test(system), "the prompt forbids placeholders and emojis");

console.log("\n— what comes back from the model —");
ok(cleanMessage("Here's a message:\n\n\"Hi Sumeet, saw your work at Salesforce. How is the fintech push going?\"") ===
  "Hi Sumeet, saw your work at Salesforce. How is the fintech push going?", "strips a preamble and surrounding quotes");
ok(cleanMessage("<think>they work at Salesforce</think>Hi Sumeet, how is enterprise sales treating you this quarter?") ===
  "Hi Sumeet, how is enterprise sales treating you this quarter?", "strips a reasoning model's thinking");
ok(cleanMessage("Hi Sumeet, **great** to connect — how is the team at Salesforce?") === "Hi Sumeet, great to connect — how is the team at Salesforce?", "strips markdown emphasis");
ok(cleanMessage("Hi [First Name], loved what you're doing at [Company]!") === null, "refuses a reply that still has template placeholders");
ok(cleanMessage("Hi!") === null && cleanMessage("   ") === null, "refuses an empty or trivial reply");
const long = cleanMessage(`Hi Sumeet. ${"This sentence keeps the message going. ".repeat(40)}`);
ok(!!long && long.length <= LINKEDIN_MESSAGE_MAX && long.endsWith("."), "caps an over-long reply at a sentence end", `length=${long?.length}`);

console.log("\n— what a campaign step sends —");
const rendered = { body: "Hi {{firstName}} template", subject: undefined };
ok(stepNote({ kind: "message", savedMessage: "Saved message for Sumeet", rendered }) === "Saved message for Sumeet", "a message step sends the lead's saved message");
ok(stepNote({ kind: "message", savedMessage: "   ", rendered }) === "Hi {{firstName}} template", "...and falls back to the template when there isn't one");
ok(stepNote({ kind: "message", savedMessage: null, rendered }) === "Hi {{firstName}} template", "...including when it was never written");
ok(stepNote({ kind: "invite", noteFor: "everyone", savedMessage: "Saved message", rendered }) === "Hi {{firstName}} template", "an invitation keeps its template note, never the saved message");
ok(stepNote({ kind: "invite", noteFor: "none", savedMessage: "Saved message", rendered }) === null, "an invitation set to no note carries nothing");
ok(stepNote({ kind: "auto", savedMessage: "Saved message", rendered }) === "Hi {{firstName}} template", "an auto step keeps the template (it may resolve to an invitation)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

import LegalPage from "@/components/site/LegalPage";

export const metadata = {
  title: "Chrome extension privacy — Followthroo",
  description:
    "What the Followthroo for LinkedIn Chrome extension accesses, what it sends, and what it never touches.",
};

/**
 * The privacy policy the Chrome Web Store listing points at.
 *
 * Deliberately separate from /privacy: the Web Store requires a policy that
 * covers the extension's own data handling specifically, and reviewers check
 * that each requested permission is justified in it. A generic company policy
 * gets listings rejected.
 */
export default function ExtensionPrivacyPage() {
  return (
    <LegalPage
      title="Chrome extension privacy"
      updated="September 2026"
      sections={[
        {
          heading: "The short version",
          body: "The extension runs inside your own logged-in LinkedIn tab. It never asks for your LinkedIn password, never stores your LinkedIn session, and never sends a message, connection request or comment on its own — a person clicks send, every time.",
        },
        {
          heading: "What it reads",
          body: "When you ask Followthroo to source contacts from a LinkedIn page, the extension opens that page in your browser and reads what is already displayed on it — names, headlines, locations, employers and public profile links. This is the same information visible to you when you look at that page yourself. It reads nothing you are not already permitted to see, and it reads nothing unless you have asked for a specific page.",
        },
        {
          heading: "What it sends to Followthroo",
          body: "Only the rows read from a page you requested, plus the status of jobs you queued. Those rows go to your own Followthroo workspace and are visible to you and the teammates you share that workspace with. Nothing is sold, shared with third parties, or used to train anything.",
        },
        {
          heading: "What it stores on your computer",
          body: "Your Followthroo web address, a connection token that identifies your workspace, your pacing and daily-limit preferences, and the status of the job currently running. This is held in Chrome's local extension storage on your machine. Removing the extension deletes all of it.",
        },
        {
          heading: "What it never touches",
          body: "Your LinkedIn password, your LinkedIn session cookie, your private messages other than the conversations you explicitly ask to sync, your browsing on any other website, and any page outside linkedin.com. The extension has no access to other tabs or other sites.",
        },
        {
          heading: "Why it needs each permission",
          body: "linkedin.com access: to open and read the specific pages you request. Followthroo access: to receive your queued jobs and return the results. Storage: to remember your settings and token. Alarms: to pace work at safe, human intervals rather than in bursts. Scripting: to read the contents of the LinkedIn page you asked about. It does not request access to your tabs or your browsing history.",
        },
        {
          heading: "Sending is always yours",
          body: "For connection requests and messages, the extension opens the page and fills in the text, then stops. You read it, edit it if you want, and press send yourself. This is deliberate: it keeps you in control of what goes out under your name, and it keeps your LinkedIn account within LinkedIn's own terms.",
        },
        {
          heading: "Deleting your data",
          body: "Uninstalling the extension removes everything it stored locally. Contacts already imported into your Followthroo workspace are yours to export or delete from within the app at any time. Email privacy@followthroo.com and we will help.",
        },
        {
          heading: "Contact",
          body: "Questions about the extension specifically? Email privacy@followthroo.com.",
        },
      ]}
    />
  );
}

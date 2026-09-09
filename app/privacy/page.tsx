import LegalPage from "@/components/site/LegalPage";

export const metadata = { title: "Privacy — Followthroo" };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 2026"
      sections={[
        { heading: "What we collect", body: "Account details you provide, and the lead data you import to run campaigns (names, emails, phone numbers, LinkedIn URLs, and any custom fields)." },
        { heading: "How we use it", body: "Solely to deliver the service — sending, tracking, and reporting on your outreach. We do not sell your data or your leads' data." },
        { heading: "Storage & security", body: "Data is encrypted in transit. The credentials you connect — mailbox passwords, OAuth tokens, signing keys — are encrypted at rest under a key held outside the database. Access is role-restricted and secrets are never kept in code." },
        { heading: "Your rights", body: "You can export or delete your data at any time. Deleting a lead also adds them to a global suppression list so they are never contacted again." },
        { heading: "Contact", body: "Questions about privacy? Email privacy@followthroo.com." },
      ]}
    />
  );
}

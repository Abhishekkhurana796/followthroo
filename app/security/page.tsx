import LegalPage from "@/components/site/LegalPage";

export const metadata = { title: "Security — Followthroo" };

export default function SecurityPage() {
  return (
    <LegalPage
      title="Security"
      updated="September 2026"
      sections={[
        { heading: "Secrets management", body: "All credentials live in environment variables or a vault with least-privilege scopes — never in source, logs, or the client bundle." },
        { heading: "Encryption", body: "TLS everywhere in transit. At rest, the credentials you entrust us with — mailbox passwords, OAuth refresh tokens and DKIM signing keys — are encrypted with AES-256-GCM under a key held outside the database, and rotated without downtime." },
        { heading: "Access control", body: "Role-based access gates campaigns and raw contact data. Sessions use secure, HTTP-only cookies." },
        { heading: "Webhooks", body: "Inbound webhooks (Twilio, email providers) are signature-verified before their payloads are trusted." },
        { heading: "Reporting", body: "Found an issue? Email security@followthroo.com — we respond quickly and credit responsible disclosure." },
      ]}
    />
  );
}

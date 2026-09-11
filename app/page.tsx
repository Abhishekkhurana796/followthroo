import Nav from "@/components/marketing/Nav";
import Hero from "@/components/marketing/Hero";
import ChannelCards from "@/components/marketing/ChannelCards";
import HowItWorks from "@/components/marketing/HowItWorks";
import Safety from "@/components/marketing/Safety";
import SendingInfrastructure from "@/components/marketing/SendingInfrastructure";
import FAQ from "@/components/marketing/FAQ";
import StudioStrip from "@/components/site/StudioStrip";
import CTA from "@/components/marketing/CTA";

/** Makes the studio relationship machine-readable, not just visible in the footer. */
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Followthroo",
  applicationCategory: "BusinessApplication",
  description:
    "AI-powered outreach across email, LinkedIn, WhatsApp, and social — one clear, consistent story.",
  url: "https://followthroo.com",
  publisher: {
    "@type": "Organization",
    name: "brandstac",
    url: "https://brandstac.com",
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <Nav />
      <main>
        <Hero />
        <ChannelCards />
        <HowItWorks />
        <Safety />
        <SendingInfrastructure />
        <FAQ />
        {/* CTA renders the Footer, so everything else must stay above it. */}
        <StudioStrip />
        <CTA />
      </main>
    </>
  );
}

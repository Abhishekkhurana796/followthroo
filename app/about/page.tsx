import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import { Prose, CTABand } from "@/components/site/blocks";

export const metadata = {
  title: "About — Followthroo",
  description: "Followthroo exists to align messy, scattered outreach into one clear, consistent story — across Email, LinkedIn, and WhatsApp.",
  openGraph: {
    title: "About — Followthroo",
    description: "Followthroo exists to align messy, scattered outreach into one clear, consistent story — across Email, LinkedIn, and WhatsApp.",
    url: "https://followthroo.com/about",
  },
};

export default function AboutPage() {
  return (
    <SiteShell>
      <PageHero
        kicker="About"
        title="We build outreach that stays human"
        subtitle="Followthroo exists to align messy, scattered outreach into one clear, consistent story — across every channel."
      />
      <Prose>
        <p>
          We kept seeing the same pattern: teams with real value to offer, lost between spreadsheets,
          disconnected tools, and outreach that either felt robotic or got their accounts flagged.
        </p>
        <h2>Our belief</h2>
        <p>
          Personalized outreach gets replies; generic blasts get ignored. But personalization at scale is
          hard, and every platform has hard limits. Followthroo handles both — so you can reach more
          people, more genuinely, without waking the spam kraken.
        </p>
        <h2>How we work</h2>
        <p>
          Safety is the default, not a setting. Every send passes a rate-limit and consent check first.
          When patterns stay predictable, trust builds — for your prospects and your sending accounts alike.
        </p>
        <h2>Who builds Followthroo</h2>
        <p>
          Followthroo is the in-house product of{" "}
          <a href="https://brandstac.com" target="_blank" rel="noopener noreferrer">
            brandstac
          </a>
          , a creative technology studio in New Delhi. brandstac works across six disciplines — custom
          software, AI solutions, performance marketing, AI ad creative, social media, and ecommerce and
          CMS development — under one standard, with the same person accountable from the first product
          decision to the last line of backend code.
        </p>
        <p>
          That shape is why Followthroo looks the way it does. There is no hand-off between the people
          who decide what outreach should feel like and the people who build the sending engine
          underneath it. You can read more{" "}
          <a href="https://brandstac.com/about" target="_blank" rel="noopener noreferrer">
            about the studio
          </a>{" "}
          or see{" "}
          <a href="https://brandstac.com/services" target="_blank" rel="noopener noreferrer">
            what it does
          </a>
          .
        </p>
      </Prose>
      <CTABand />
    </SiteShell>
  );
}

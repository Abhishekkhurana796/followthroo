import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import ChangelogNav from "@/components/site/ChangelogNav";
import ChangelogList from "@/components/site/ChangelogList";
import { CHANGELOG } from "@/lib/changelog-data";

export const metadata = { title: "Chrome extension changelog — Followthroo" };

export default function ExtensionChangelogPage() {
  const entries = CHANGELOG.filter((e) => e.product === "extension");
  return (
    <SiteShell>
      <PageHero
        kicker="Changelog"
        title="The Chrome extension"
        subtitle="Every release of Followthroo for LinkedIn, newest first."
      />
      <ChangelogNav />
      <section className="bg-canvas pb-24">
        <div className="mx-auto max-w-3xl px-6">
          <ChangelogList entries={entries} />
        </div>
      </section>
    </SiteShell>
  );
}

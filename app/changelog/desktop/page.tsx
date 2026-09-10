import SiteShell from "@/components/site/SiteShell";
import PageHero from "@/components/site/PageHero";
import ChangelogNav from "@/components/site/ChangelogNav";
import ChangelogList from "@/components/site/ChangelogList";
import { CHANGELOG } from "@/lib/changelog-data";

export const metadata = { title: "Desktop app changelog — Followthroo" };

export default function DesktopChangelogPage() {
  const entries = CHANGELOG.filter((e) => e.product === "desktop");
  return (
    <SiteShell>
      <PageHero
        kicker="Changelog"
        title="The desktop app"
        subtitle="Every release of the Windows app that sends your LinkedIn invitations, newest first."
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

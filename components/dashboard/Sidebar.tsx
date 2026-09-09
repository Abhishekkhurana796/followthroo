"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FileText, Settings, CreditCard, Bell, Megaphone, MessagesSquare, Chrome,
  LogOut, ChevronsUpDown, Plus, Check, Menu, X,
  type LucideIcon,
} from "lucide-react";
import { signOut, useSession, authClient } from "@/lib/auth-client";
import { Popover, useConfirm, usePrompt, useToast } from "@/components/ui";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { tourTarget } from "@/components/dashboard/tour/target";
import { ReplayTourMenuItem } from "@/components/dashboard/tour/ReplayTourButton";
import { NAV_GROUPS, NAV_TOUR_TARGETS, isActiveHref, type NavItem } from "@/components/dashboard/nav-items";

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  if (item.soon) {
    return (
      <div className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-faint" title="Coming soon">
        <item.icon className="h-4 w-4" />
        <span>{item.label}</span>
        <span className="ml-auto rounded-full bg-tint px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-faint">Soon</span>
      </div>
    );
  }
  const tt = NAV_TOUR_TARGETS[item.label];
  return (
    <Link
      href={item.href!}
      {...(tt ? tourTarget(tt) : {})}
      className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? "bg-accent-soft font-semibold text-accent-strong" : "text-ink-soft hover:bg-tint hover:text-ink"
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />}
      <item.icon className={`h-4 w-4 ${active ? "text-accent" : ""}`} />
      <span>{item.label}</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on navigation — otherwise it stays over the page the user
  // just asked for.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    document.addEventListener("keydown", onEsc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  return (
    <>
      {/* Mobile top bar — the only nav affordance below lg */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-surface px-4 lg:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="-ml-1 rounded-lg p-2 text-ink-soft transition-colors hover:bg-tint hover:text-ink"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" aria-label="Followthroo home" className="flex items-center">
          <span className="relative block h-7 w-32 overflow-hidden">
            <Image src="/logo.png" alt="Followthroo" fill sizes="128px" className="object-cover object-center" />
          </span>
        </Link>
      </div>

      {/* Scrim. The drawer itself gets `translate-x`, which would make it a
          containing block for any fixed descendant — harmless only because every
          overlay portals to the top layer. */}
      {drawerOpen && (
        <div
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-scrim lg:hidden"
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-line bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-full lg:max-w-[240px] lg:shrink-0 lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-5">
          {/* Logo — object-cover crops the wordmark's whitespace out of the 2:1 asset */}
          <Link href="/dashboard" aria-label="Followthroo home" className="flex items-center">
            <span className="relative block h-8 w-40 overflow-hidden">
              <Image src="/logo.png" alt="Followthroo" fill sizes="160px" className="object-cover object-center" priority />
            </span>
          </Link>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
            className="-mr-1 rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-tint hover:text-ink lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.title ?? gi} className={group.title ? "pt-2" : ""}>
              {group.title && (
                <div className="px-3 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => (
                <NavRow key={item.label} item={item} active={isActiveHref(pathname, item.href)} />
              ))}
            </div>
          ))}
        </nav>

        <ProfileMenu />
      </aside>
    </>
  );
}

/* ---- Account / workspace dropdown (opens upward) ---- */
function ProfileMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const { data: org } = authClient.useActiveOrganization();
  const { data: orgs } = authClient.useListOrganizations();
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();

  const email = session?.user?.email ?? "";
  const name = session?.user?.name?.trim() || email.split("@")[0] || "You";
  const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "U";

  async function switchOrg(id: string) {
    if (id === org?.id) return setOpen(false);
    await authClient.organization.setActive({ organizationId: id });
    window.location.reload();
  }
  async function createOrg() {
    setOpen(false);
    const n = await prompt({
      title: "Create a workspace",
      body: "Workspaces keep contacts, campaigns and sending accounts separate.",
      label: "Workspace name",
      placeholder: "Acme Sales",
      confirmLabel: "Create workspace",
    });
    if (!n) return;
    const slug = `${n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await authClient.organization.create({ name: n, slug });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = (res.data as any)?.id;
    if (!id) return toast("Couldn't create the workspace. Try a different name.", "error");
    await switchOrg(id);
  }
  async function handleSignOut() {
    setOpen(false);
    if (!(await confirm({ title: "Sign out?", confirmLabel: "Sign out", cancelLabel: "Stay signed in" }))) return;
    await signOut({ fetchOptions: { onSuccess: () => router.push("/sign-in") } });
  }

  const link = (href: string, Icon: LucideIcon, label: string, soon?: boolean) =>
    soon ? (
      <div className="flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-faint">
        <Icon className="h-4 w-4" /> {label}
        <span className="ml-auto rounded-full bg-tint px-1.5 py-0.5 font-mono text-[9px] uppercase text-ink-faint">Soon</span>
      </div>
    ) : (
      <Link href={href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-tint hover:text-ink">
        <Icon className="h-4 w-4" /> {label}
      </Link>
    );

  return (
    <div className="shrink-0 border-t border-line p-3">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="top-start"
        matchTriggerWidth
        className="max-h-[70vh]"
        trigger={
          <button
            {...tourTarget("profile-menu")}
            aria-label="Account and workspace menu"
            className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${open ? "bg-tint" : "hover:bg-tint"}`}
          >
            <Avatar initials={initials} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{name}</div>
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs text-ink-soft">{org?.name ?? "Workspace"}</span>
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-strong">Free</span>
              </div>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-soft" />
          </button>
        }
      >
        <div className="flex items-center gap-3 px-2.5 py-2">
          <Avatar initials={initials} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-ink-soft">{email}</div>
          </div>
        </div>

        <div className="my-1 h-px bg-line" />
        {link("/dashboard/settings", Settings, "Settings")}
        {link("/dashboard/settings/billing", CreditCard, "Plans & billing")}
        {link("/dashboard/settings/notifications", Bell, "Notifications")}
        {link("/dashboard/templates", FileText, "Templates")}

        <div className="my-1 h-px bg-line" />
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <span className="text-sm text-ink-soft">Theme</span>
          <ThemeToggle className="scale-90 origin-right" />
        </div>

        <div className="my-1 h-px bg-line" />
        <ReplayTourMenuItem onNavigate={() => setOpen(false)} />
        {link("/changelog", Megaphone, "Product updates")}
        {link("/contact", MessagesSquare, "Share feedback")}
        {link("/dashboard/linkedin", Chrome, "Install Chrome extension")}

        <div className="my-1 h-px bg-line" />
        <div className="px-2.5 pb-1 pt-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">Workspace</div>
        {(orgs ?? []).map((o) => (
          <button key={o.id} onClick={() => switchOrg(o.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-tint">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-tint text-[10px] font-bold">{o.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            {o.id === org?.id && <Check className="h-4 w-4 text-accent" />}
          </button>
        ))}
        <button onClick={createOrg} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-tint hover:text-ink">
          <Plus className="h-4 w-4" /> New workspace
        </button>

        <div className="my-1 h-px bg-line" />
        <button onClick={handleSignOut} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink-soft transition-colors hover:bg-tint hover:text-ink">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </Popover>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-on-solid">
      {initials}
    </span>
  );
}

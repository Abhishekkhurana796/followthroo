"use client";

import { useState } from "react";
import useSWR from "swr";
import { UserPlus, Trash2, Building2, Copy, Check, Shield } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import { api } from "@/lib/client";
import { Banner, DashHeader, Input, Label, Panel, Select, useConfirm, usePrompt } from "@/components/ui";
import { ASSIGNABLE_ROLES, ROLE_INFO, roleLabel, canManageWorkspace, type Role } from "@/lib/roles";
import { Skeleton } from "@/components/ui";

type Department = "marketing" | "sales" | "support" | "collections" | "recruitment";
type ApiMember = {
  id: string;
  userId: string;
  role: Role;
  department: Department | null;
  managerId: string | null;
  user: { id: string; name: string | null; email: string };
};

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "support", label: "Support" },
  { value: "collections", label: "Collections" },
  { value: "recruitment", label: "Recruitment" },
];

const appUrl = typeof window !== "undefined" ? window.location.origin : "";

export default function TeamClient() {
  const { data: session } = useSession();
  const { data: org, isPending, refetch } = authClient.useActiveOrganization();
  const { data: orgs } = authClient.useListOrganizations();
  // better-auth's own member list has no concept of department/manager — those are
  // custom columns on the same table, so the source of truth here is our own route.
  const {
    data: members = [],
    isLoading: membersLoading,
    mutate: refetchMembers,
  } = useSWR<ApiMember[]>("/api/team/members");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  type PendingInvite = { id: string; email: string; role: string; status: string };
  const invitations: PendingInvite[] = (
    ((org as { invitations?: PendingInvite[] } | null)?.invitations ?? [])
  ).filter((i) => i.status === "pending");
  const me = members.find((m) => m.userId === session?.user?.id);
  const canManage = canManageWorkspace(me?.role ?? "");

  async function updateHierarchy(
    memberId: string,
    data: { department?: Department | null; managerId?: string | null },
  ) {
    setMsg(null);
    try {
      await api(`/api/team/members/${memberId}`, { method: "PATCH", body: data });
      await refetchMembers();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    // No cast needed any more: lib/auth.ts registers all four roles with the
    // organization plugin, so group_leader is a value it actually knows.
    const res = await authClient.organization.inviteMember({ email: email.trim(), role });
    setBusy(false);
    if (res.error) return setMsg({ kind: "error", text: res.error.message ?? "Failed to invite" });
    setEmail("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = (res.data as { id?: string } | null)?.id;
    setMsg({
      kind: "success",
      text: id
        ? `Invited ${email} — we've emailed them. If it doesn't arrive, share this link: ${appUrl}/accept-invitation/${id}`
        : `Invited ${email} — we've emailed them.`,
    });
    refetch?.();
  }

  async function cancelInvite(invitationId: string) {
    await authClient.organization.cancelInvitation({ invitationId });
    refetch?.();
  }

  async function removeMember(memberIdOrEmail: string) {
    const ok = await confirm({
      title: "Remove this member?",
      body: "They lose access to this workspace's contacts, campaigns and inbox immediately.",
      confirmLabel: "Remove member",
      tone: "danger",
    });
    if (!ok) return;
    await authClient.organization.removeMember({ memberIdOrEmail });
    refetch?.();
    refetchMembers();
  }

  async function changeRole(memberId: string, newRole: Role) {
    await authClient.organization.updateMemberRole({ memberId, role: newRole });
    refetch?.();
    refetchMembers();
  }

  async function switchOrg(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    window.location.reload();
  }

  async function createOrg() {
    const name = await prompt({
      title: "Create a workspace",
      body: "Workspaces keep contacts, campaigns and sending accounts separate.",
      label: "Workspace name",
      placeholder: "Acme Sales",
      confirmLabel: "Create workspace",
    });
    if (!name) return;
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const res = await authClient.organization.create({ name, slug });
    const id = (res.data as { id?: string } | null)?.id;
    if (id) await switchOrg(id);
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div>
      <DashHeader title="Team" subtitle="Manage who can access this workspace and their roles." />

      <div className="mx-auto max-w-4xl space-y-6 p-8">
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}

        {/* Workspace switcher */}
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-tint">
                <Building2 className="h-5 w-5" />
              </span>
              <div>
                <div className="font-display text-lg font-bold">{org?.name ?? "Workspace"}</div>
                <div className="text-xs text-ink-soft">{members.length} member{members.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {orgs && orgs.length > 1 && (
                <Select
                  value={org?.id ?? ""}
                  onChange={(e) => switchOrg(e.target.value)}
                  className="w-52"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </Select>
              )}
              <button onClick={createOrg} className="btn btn-ghost whitespace-nowrap text-sm">
                New workspace
              </button>
            </div>
          </div>
        </Panel>

        {/* Invite */}
        {canManage && (
          <Panel>
            <h2 className="mb-4 flex items-center gap-2 font-display text-base font-bold">
              <UserPlus className="h-4 w-4" /> Invite a teammate
            </h2>
            <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <Label>Email</Label>
                <Input
                  type="email"
                  placeholder="teammate@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="w-40">
                <Label>Role</Label>
                <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_INFO[r].label}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-ink-faint">{ROLE_INFO[role].description}</p>
              </div>
              <button type="submit" disabled={busy} className="btn btn-primary text-sm">
                {busy ? "Inviting…" : "Send invite"}
              </button>
            </form>
          </Panel>
        )}

        {/* Members */}
        <Panel>
          <h2 className="mb-4 font-display text-base font-bold">Members</h2>
          {membersLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-xl" />)}</div>
          ) : (
            <div className="divide-y divide-line">
              {members.map((m) => {
                const editable = canManage && m.role !== "owner" && m.userId !== session?.user?.id;
                const manager = members.find((x) => x.id === m.managerId);
                return (
                  <div key={m.id} className="space-y-2 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{m.user?.name || m.user?.email}</div>
                        <div className="truncate text-xs text-ink-soft">{m.user?.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {editable ? (
                          <Select
                            value={m.role}
                            onChange={(e) => changeRole(m.id, e.target.value as Role)}
                            className="w-36 !py-1.5 text-xs"
                          >
                            {ASSIGNABLE_ROLES.map((r) => (
                              <option key={r} value={r}>{ROLE_INFO[r].label}</option>
                            ))}
                          </Select>
                        ) : (
                          <span className="flex items-center gap-1 rounded-lg bg-tint px-2.5 py-1 text-xs font-medium capitalize">
                            {m.role === "owner" && <Shield className="h-3 w-3" />} {roleLabel(m.role)}
                          </span>
                        )}
                        {editable && (
                          <button
                            onClick={() => removeMember(m.id)}
                            className="rounded-lg p-1.5 text-ink-soft hover:bg-tint hover:text-danger"
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Org hierarchy (PRD §4): which department this person's pipeline
                        work belongs to, and who the SLA escalation chain walks to. */}
                    {editable ? (
                      <div className="flex flex-wrap items-center gap-2 pl-0.5">
                        <Select
                          value={m.department ?? ""}
                          onChange={(e) => updateHierarchy(m.id, { department: (e.target.value || null) as Department | null })}
                          className="w-36 !py-1.5 text-xs"
                        >
                          <option value="">No department</option>
                          {DEPARTMENTS.map((d) => (
                            <option key={d.value} value={d.value}>{d.label}</option>
                          ))}
                        </Select>
                        <span className="text-xs text-ink-faint">reports to</span>
                        <Select
                          value={m.managerId ?? ""}
                          onChange={(e) => updateHierarchy(m.id, { managerId: e.target.value || null })}
                          className="w-40 !py-1.5 text-xs"
                        >
                          <option value="">Nobody</option>
                          {members
                            .filter((x) => x.id !== m.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>{x.user?.name || x.user?.email}</option>
                            ))}
                        </Select>
                      </div>
                    ) : (
                      (m.department || manager) && (
                        <div className="flex flex-wrap items-center gap-1.5 pl-0.5 text-xs text-ink-soft">
                          {m.department && (
                            <span className="rounded-md bg-tint px-2 py-0.5 capitalize">{m.department}</span>
                          )}
                          {manager && <span>reports to {manager.user?.name || manager.user?.email}</span>}
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <Panel>
            <h2 className="mb-4 font-display text-base font-bold">Pending invitations</h2>
            <div className="divide-y divide-line">
              {invitations.map((inv) => {
                const link = `${appUrl}/accept-invitation/${inv.id}`;
                return (
                  <div key={inv.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{inv.email}</div>
                      <div className="text-xs text-ink-soft">{roleLabel(inv.role)} · pending</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copy(link, inv.id)}
                        className="flex items-center gap-1 rounded-lg bg-tint px-2.5 py-1.5 text-xs hover:bg-line"
                      >
                        {copied === inv.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied === inv.id ? "Copied" : "Copy link"}
                      </button>
                      {canManage && (
                        <button
                          onClick={() => cancelInvite(inv.id)}
                          className="rounded-lg p-1.5 text-ink-soft hover:bg-tint hover:text-danger"
                          title="Cancel"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

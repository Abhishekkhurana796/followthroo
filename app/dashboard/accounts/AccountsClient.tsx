"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/client";
import { Banner, DashHeader, EmptyState, Input, Label, Panel, Select, useConfirm } from "@/components/ui";
import { Trash2, ShieldCheck, Mail, Server, RefreshCw } from "lucide-react";
import { SendingDomainsPanel } from "@/components/dashboard/SendingDomainsPanel";

type SendingAccount = {
  id: string;
  name: string;
  email: string;
  provider: string; // "smtp" | "gmail_oauth" | "managed"
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string | null;
  active: boolean;
  createdAt: string;
};

export default function SendingAccountsPage() {
  const { data: accounts = [], mutate } = useSWR<SendingAccount[]>("/api/sending-accounts");
  const confirm = useConfirm();
  const [form, setForm] = useState({
    name: "",
    email: "",
    host: "",
    port: 587,
    secure: false,
    user: "",
    pass: "",
    from: "",
  });
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    // Surface the result of a mailbox-connect redirect (Gmail or Zoho), then clean the URL.
    const p = new URLSearchParams(window.location.search);
    if (p.get("connected")) {
      setMsg({ kind: "success", text: `Gmail connected: ${p.get("connected")}` });
    } else if (p.get("error")) {
      setMsg({ kind: "error", text: `Gmail connect failed: ${p.get("error")}` });
    }
    if (p.get("connected") || p.get("error")) {
      window.history.replaceState({}, "", "/dashboard/accounts");
    }
  }, []);

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setForm((prev) => ({
      ...prev,
      port: isNaN(val) ? 587 : val,
    }));
  };

  async function testConnection(e: React.MouseEvent) {
    e.preventDefault();
    if (!form.host || !form.email || !form.user || !form.pass) {
      setMsg({ kind: "error", text: "Please fill in email, host, user, and password to test connection." });
      return;
    }
    setTestBusy(true);
    setMsg(null);
    try {
      const res = await api<{ message: string }>("/api/sending-accounts?test=true", {
        body: form,
      });
      setMsg({ kind: "success", text: res.message || "SMTP connection verified successfully!" });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setTestBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/sending-accounts", { body: form });
      setForm({
        name: "",
        email: "",
        host: "",
        port: 587,
        secure: false,
        user: "",
        pass: "",
        from: "",
      });
      setMsg({ kind: "success", text: "Sending account saved." });
      mutate();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete this sending account?",
      body: "Campaigns using it will stop sending until you connect another mailbox.",
      confirmLabel: "Delete account",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/sending-accounts?id=${id}`, { method: "DELETE" });
      setMsg({ kind: "success", text: "Sending account deleted." });
      mutate();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  return (
    <>
      <DashHeader
        title="Mailboxes & domains"
        subtitle="The domains you send from, and the mailboxes that send."
      />
      {/* Domains come first: on this screen the domain is the container and the
          mailbox is the thing inside it, so reading order should match. */}
      <div className="px-8 pt-8">
        <SendingDomainsPanel />
      </div>
      <div className="grid gap-6 p-8 lg:grid-cols-[380px_1fr]">
        <Panel className="h-fit">
          <h2 className="font-display text-lg font-bold">Connect a mailbox you already have</h2>

          <a
            href="/api/auth/google/start"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm font-semibold transition hover:bg-tint"
          >
            <Mail className="h-4 w-4 text-action" />
            Connect Gmail (one click, no password)
          </a>

          <a
            href="/api/auth/zoho/start"
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm font-semibold transition hover:bg-tint"
          >
            <Mail className="h-4 w-4 text-action" />
            Connect Zoho Mail (one click, no password)
          </a>
          <div className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-wide text-ink-soft">
            <span className="h-px flex-1 bg-line" />
            or add SMTP manually
            <span className="h-px flex-1 bg-line" />
          </div>

          <form onSubmit={create} className="mt-1 space-y-3">
            <div>
              <Label>Account Name *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Sales Gmail, Work Account"
              />
            </div>
            <div>
              <Label>Sender Email *</Label>
              <Input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="e.g. user@yourdomain.com"
              />
            </div>
            <div>
              <Label>SMTP Host *</Label>
              <Input
                required
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="e.g. smtp.gmail.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>SMTP Port *</Label>
                <Input
                  required
                  type="number"
                  value={form.port}
                  onChange={handlePortChange}
                  placeholder="587"
                />
              </div>
              <div>
                <Label>Connection Security</Label>
                <Select
                  value={form.secure ? "ssl" : "tls"}
                  onChange={(e) => setForm({ ...form, secure: e.target.value === "ssl" })}
                >
                  <option value="tls">STARTTLS (Port 587/25)</option>
                  <option value="ssl">SSL/TLS (Port 465)</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>Username *</Label>
              <Input
                required
                value={form.user}
                onChange={(e) => setForm({ ...form, user: e.target.value })}
                placeholder="SMTP User (often matches email)"
              />
            </div>
            <div>
              <Label>Password / App Password *</Label>
              <Input
                required
                type="password"
                value={form.pass}
                onChange={(e) => setForm({ ...form, pass: e.target.value })}
                placeholder="App Password / Credentials"
              />
            </div>
            <div>
              <Label>Custom From Name (Optional)</Label>
              <Input
                value={form.from || ""}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                placeholder='e.g. "Jane Doe <jane@company.com>"'
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={testConnection}
                disabled={testBusy || busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-canvas px-4 py-2.5 text-sm font-medium transition hover:bg-tint disabled:opacity-50"
              >
                {testBusy ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4 text-success" />
                )}
                Test SMTP
              </button>
              <button
                type="submit"
                disabled={busy || testBusy}
                className="btn btn-primary flex flex-1 justify-center disabled:opacity-50"
              >
                Save Account
              </button>
            </div>
          </form>
        </Panel>

        <div className="space-y-4">
          {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
          {accounts.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="No mailbox connected"
              body="Campaigns and the agent need somewhere to send from. Buy a fresh domain and mailboxes above, connect Gmail in one click, or add SMTP details on the left."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {accounts.map((acc) => (
                <Panel key={acc.id} className="relative flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-5 w-5 text-action" />
                      <h3 className="font-display font-bold">{acc.name}</h3>
                      {acc.provider === "managed" && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent-strong">
                          Managed
                        </span>
                      )}
                      {acc.active && (
                        <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-bold text-success-strong">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink font-medium">{acc.email}</p>
                    <div className="mt-3 flex items-center gap-1.5 font-mono text-xs text-ink-soft">
                      <Server className="h-3.5 w-3.5" />
                      <span>
                        {acc.provider === "gmail_oauth"
                          ? "Gmail API (OAuth)"
                          : `${acc.host}:${acc.port} (${acc.secure ? "SSL" : "TLS"})`}
                      </span>
                    </div>
                    {acc.from && (
                      <p className="mt-2 text-xs text-ink-soft">
                        From header: <span className="font-mono">{acc.from}</span>
                      </p>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                    <span className="text-[10px] text-ink-soft">
                      Added {new Date(acc.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => remove(acc.id)}
                      className="rounded-lg p-1.5 text-ink-soft hover:bg-danger-soft hover:text-danger transition"
                      title="Delete account"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

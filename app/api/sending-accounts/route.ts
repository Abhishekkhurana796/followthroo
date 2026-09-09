import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { requireOrg, requireRole } from "@/lib/tenant";
import nodemailer from "nodemailer";

export const runtime = "nodejs";

const AccountSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean().default(false),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().optional().nullable(),
  active: z.boolean().default(true),
  // Optional per-account DKIM signing
  dkimDomain: z.string().optional().nullable(),
  dkimSelector: z.string().optional().nullable(),
  dkimPrivateKey: z.string().optional().nullable(),
  // Set when the mailbox was bought on a sending domain we track, so the domain
  // page can list it and warm-up can start without a second trip.
  domainId: z.string().optional().nullable(),
  startWarmup: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  // Never expose secrets (pass / refreshToken) to the client.
  const accounts = await prisma.sendingAccount.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      provider: true,
      host: true,
      port: true,
      secure: true,
      user: true,
      from: true,
      active: true,
      createdAt: true,
    },
  });
  return ok(accounts);
}

export async function POST(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  // A mailbox is workspace infrastructure, not a rep's own setting: connecting
  // one binds the org's sending reputation to a credential. Reading the list
  // stays open (the campaign UI needs it); creating and deleting do not.
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;

  try {
    const body = await req.json().catch(() => null);
    const isTestOnly = req.nextUrl.searchParams.get("test") === "true";
    const parsed = AccountSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid account input data");
    }

    const data = parsed.data;

    // Test connection
    const transporter = nodemailer.createTransport({
      host: data.host,
      port: data.port,
      secure: data.secure,
      auth: {
        user: data.user,
        pass: data.pass,
      },
    });

    try {
      await transporter.verify();
    } catch (testErr) {
      console.error("[sending-accounts] SMTP connection verification failed:", testErr);
      return fail(
        `SMTP Connection failed: ${testErr instanceof Error ? testErr.message : String(testErr)}`,
        400
      );
    }

    if (isTestOnly) {
      return ok({ message: "SMTP connection verified successfully!" });
    }

    // Check if account already exists with this email in this org
    const existing = await prisma.sendingAccount.findUnique({
      where: { organizationId_email: { organizationId: ctx.orgId, email: data.email } },
    });

    if (existing) {
      return fail(`A sending account with email ${data.email} already exists`, 400);
    }

    // Only accept a domain this org actually owns — otherwise the id is just
    // untrusted input that would attach the mailbox to someone else's domain.
    const domainId = data.domainId
      ? (
          await prisma.domain.findFirst({
            where: { id: data.domainId, organizationId: ctx.orgId },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const account = await prisma.sendingAccount.create({
      data: {
        organizationId: ctx.orgId,
        name: data.name,
        email: data.email,
        // A mailbox on a domain bought through us is "managed" — same row, same
        // send path, it just reads differently in the UI.
        provider: domainId ? "managed" : "smtp",
        domainId,
        host: data.host,
        port: data.port,
        secure: data.secure,
        user: data.user,
        pass: data.pass,
        from: data.from || null,
        active: data.active,
        dkimDomain: data.dkimDomain || null,
        dkimSelector: data.dkimSelector || null,
        dkimPrivateKey: data.dkimPrivateKey || null,
      },
    });

    if (data.startWarmup) {
      await prisma.warmup.upsert({
        where: { sendingAccountId: account.id },
        create: { organizationId: ctx.orgId, sendingAccountId: account.id, enabled: true },
        update: { enabled: true },
      });
    }

    // Mirrors the GET select — the create result carries pass and dkimPrivateKey
    // and those must not travel back to the browser.
    return ok(
      {
        id: account.id,
        name: account.name,
        email: account.email,
        provider: account.provider,
        host: account.host,
        port: account.port,
        secure: account.secure,
        user: account.user,
        from: account.from,
        active: account.active,
        createdAt: account.createdAt,
        warmupStarted: !!data.startWarmup,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[sending-accounts] failed to handle POST request:", err);
    return fail(err instanceof Error ? err.message : "Internal Server Error", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireOrg(req);
  if (ctx instanceof Response) return ctx;
  const gate = requireRole(ctx, ["owner", "admin"]);
  if (gate) return gate;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return fail("Missing account 'id' parameter");

  const res = await prisma.sendingAccount.deleteMany({ where: { id, organizationId: ctx.orgId } });
  if (res.count === 0) return fail("Account not found or could not be deleted", 404);
  return ok({ deleted: id });
}

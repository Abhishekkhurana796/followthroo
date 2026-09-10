/**
 * LinkedIn extension auth. Each member gets a `LinkedInAccount` holding an `extToken`
 * (a bearer the Chrome extension sends). One account per (org, user).
 */
import { prisma } from "../db";
import { fail } from "../http";
import { LIMITS, tooMany } from "../api-ratelimit";
import { randomBytes } from "node:crypto";

export function genToken() {
  return randomBytes(24).toString("base64url");
}

export async function getOrCreateAccount(organizationId: string, userId: string) {
  const existing = await prisma.linkedInAccount.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (existing) return existing;
  return prisma.linkedInAccount.create({
    data: { organizationId, userId, extToken: genToken() },
  });
}

/**
 * Resolve an extension request (Bearer <extToken>) to its LinkedInAccount — or a
 * 401, or a 429 once the token is over its request limit.
 *
 * Every extension and desktop route comes through here, so one limit covers them
 * all. The extension asks a few times per page and the desktop app once per
 * invitation; a token calling in a loop — a bug, or a leaked token — stops here
 * rather than in the database.
 */
export async function requireExtAuth(req: Request) {
  const authz = req.headers.get("authorization") ?? "";
  const token = (authz.startsWith("Bearer ") ? authz.slice(7) : req.headers.get("x-ext-token") ?? "").trim();
  if (!token) return fail("missing extension token", 401);
  const account = await prisma.linkedInAccount.findUnique({ where: { extToken: token } });
  if (!account) return fail("invalid extension token", 401);
  const limited = await tooMany(`ext:${account.id}`, LIMITS.extension);
  if (limited) return limited;
  return account;
}

import { PrismaClient } from "@prisma/client";
import { encryptionExtension } from "./db-encryption";

/**
 * Singleton Prisma client (avoids exhausting connections during dev HMR).
 *
 * Extended with transparent column encryption — see lib/db-encryption.ts.
 * Everything in the app, better-auth's adapter included, goes through this
 * instance, which is what makes "credentials are encrypted at rest" a property
 * of the client rather than a rule each call site has to remember.
 */
function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends(encryptionExtension());
}

type ExtendedClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedClient };

export const prisma: ExtendedClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

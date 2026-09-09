/**
 * Posting to a member's LinkedIn feed, through the official API.
 *
 * This is the one LinkedIn action that needs no extension and no browser: the
 * member granted `w_member_social` at consent, so the post is made server-side,
 * on schedule, whether or not their laptop is on. It is PhantomBuster's "Auto
 * Poster" (docs/phantombuster.md #24) done the supported way.
 *
 * It is also the honest boundary of what a connected account buys us. Posting
 * is publishing your own content to your own feed, which LinkedIn sells access
 * to. Searching, inviting and messaging are not on offer at any tier, so they
 * stay in the extension where a human is present.
 */
import { prisma } from "@/lib/db";
import { connectionState } from "./oauth";

const POSTS_URL = "https://api.linkedin.com/rest/posts";

/**
 * LinkedIn versions its REST API by month and rejects calls without the header.
 * Pinned rather than floating: a silently newer version is how a working
 * integration breaks on a day nobody deployed anything.
 */
const API_VERSION = process.env.LINKEDIN_API_VERSION?.trim() || "202506";

export type PostVisibility = "PUBLIC" | "CONNECTIONS";

export interface PostResult {
  ok: boolean;
  /** The post's URN, when it worked — the permalink is derivable from it. */
  urn?: string;
  error?: string;
  /** True when the member needs to reconnect rather than when we need to retry. */
  needsReconnect?: boolean;
}

/**
 * Publish text to the connected member's feed.
 *
 * Deliberately text-only for now. Images and documents each need a separate
 * upload-then-reference dance against a different endpoint, and shipping them
 * half-done would mean a post that silently loses its attachment.
 */
export async function postToFeed(opts: {
  organizationId: string;
  userId: string;
  text: string;
  visibility?: PostVisibility;
}): Promise<PostResult> {
  const account = await prisma.linkedInAccount.findUnique({
    where: { organizationId_userId: { organizationId: opts.organizationId, userId: opts.userId } },
  });

  if (!account?.liMemberId || !account.liAccessToken) {
    return { ok: false, error: "No LinkedIn account connected.", needsReconnect: true };
  }

  const state = connectionState(account);
  if (state === "expired") {
    return {
      ok: false,
      error: "The LinkedIn connection has expired. Reconnect to keep posting.",
      needsReconnect: true,
    };
  }

  if (account.liScopes.length && !account.liScopes.includes("w_member_social")) {
    return {
      ok: false,
      error: "This LinkedIn connection was granted without posting permission. Reconnect to add it.",
      needsReconnect: true,
    };
  }

  const body = {
    author: `urn:li:person:${account.liMemberId}`,
    commentary: opts.text,
    visibility: opts.visibility ?? "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const res = await fetch(POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.liAccessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    // LinkedIn returns the new post's URN in a header, not the body.
    const urn = res.headers.get("x-restli-id") ?? undefined;
    return { ok: true, urn };
  }

  const detail = await res.text().catch(() => "");
  // 401 means the token is gone or revoked — the member has to act, and telling
  // them to "try again" would send them round a loop that cannot succeed.
  const needsReconnect = res.status === 401;
  console.error("[linkedin/post] failed:", res.status, detail.slice(0, 400));
  return {
    ok: false,
    needsReconnect,
    error: needsReconnect
      ? "LinkedIn rejected the stored credentials. Reconnect your account."
      : `LinkedIn refused the post (${res.status}).`,
  };
}

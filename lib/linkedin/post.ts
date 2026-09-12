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
 * Register an image with LinkedIn, upload its bytes, and return the asset
 * URN a post's `content.media` references. Two-step, per LinkedIn's Images
 * API: `initializeUpload` hands back a signed PUT URL and the asset's own
 * URN, then the bytes go straight to that URL — never through our own
 * `/rest/*` surface.
 */
async function uploadImage(accessToken: string, memberUrn: string, imageBytes: Uint8Array): Promise<string> {
  const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: memberUrn } }),
  });
  if (!init.ok) throw new Error(`LinkedIn refused to start the image upload (${init.status}).`);
  const initJson = (await init.json()) as { value: { uploadUrl: string; image: string } };

  const put = await fetch(initJson.value.uploadUrl, { method: "PUT", body: imageBytes as BodyInit });
  if (!put.ok) throw new Error(`Uploading the image bytes failed (${put.status}).`);

  return initJson.value.image; // e.g. "urn:li:image:C4E10AQ..."
}

/**
 * Publish text — and, when given, one image — to the connected member's
 * feed. `imageUrl` is fetched server-side (a Vercel Blob URL, typically) and
 * re-uploaded to LinkedIn; the bytes never touch the browser.
 */
export async function postToFeed(opts: {
  organizationId: string;
  userId: string;
  text: string;
  visibility?: PostVisibility;
  imageUrl?: string | null;
  imageAlt?: string | null;
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

  const authorUrn = `urn:li:person:${account.liMemberId}`;
  let media: { id: string; altText?: string } | undefined;
  if (opts.imageUrl) {
    try {
      const imgRes = await fetch(opts.imageUrl);
      if (!imgRes.ok) throw new Error(`could not fetch the image (${imgRes.status})`);
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      const imageUrn = await uploadImage(account.liAccessToken, authorUrn, bytes);
      media = { id: imageUrn, ...(opts.imageAlt ? { altText: opts.imageAlt } : {}) };
    } catch (e) {
      console.error("[linkedin/post] image upload failed, posting text only:", e);
      return { ok: false, error: `Couldn't attach the image: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  const body = {
    author: authorUrn,
    commentary: opts.text,
    visibility: opts.visibility ?? "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
    ...(media ? { content: { media } } : {}),
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

import { NextResponse } from "next/server";

// The extension (popup + Options page) calls these endpoints cross-origin with a bearer
// token — not cookies — so permissive CORS is safe.
export const LINKEDIN_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
  // x-followthroo-client is how the queue tells the desktop app apart from an
  // old extension still polling with the same token. The desktop app uses Node
  // fetch and never preflights, but anything browser-based would be blocked
  // without it listed here — and a header that is silently dropped would look
  // exactly like an empty queue.
  "Access-Control-Allow-Headers": "authorization, content-type, x-ext-token, x-followthroo-client",
};

export function corsPreflight() {
  return new NextResponse(null, { status: 204, headers: LINKEDIN_CORS });
}

export function withCors<T extends Response>(res: T): T {
  for (const [k, v] of Object.entries(LINKEDIN_CORS)) res.headers.set(k, v);
  return res;
}

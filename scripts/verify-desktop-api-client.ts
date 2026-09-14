/** Safe retry and diagnostics checks for the desktop HTTP boundary. */
import { requestJson } from "../desktop/api-client";

let passed = 0;
let failed = 0;
const ok = (condition: boolean, message: string) => {
  if (condition) { passed++; console.log("  ok  ", message); }
  else { failed++; console.log("  FAIL", message); }
};

const originalFetch = global.fetch;

async function main() {
  console.log("\ndesktop API client");

  let calls = 0;
  global.fetch = (async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error("temporary DNS failure"), { code: "EAI_AGAIN" });
    return new Response(JSON.stringify({ ok: true, data: { value: 7 } }), { status: 200 });
  }) as typeof fetch;
  const read = await requestJson("https://example.test", "/peek", { token: "secret-token", retry: "read", operation: "Read queue" });
  ok(calls === 3 && read.value === 7, "read-only requests recover from transient transport failures");

  calls = 0;
  global.fetch = (async () => {
    calls++;
    throw Object.assign(new Error("connection timed out"), { code: "UND_ERR_CONNECT_TIMEOUT" });
  }) as typeof fetch;
  let claimMessage = "";
  try { await requestJson("https://example.test", "/claim", { token: "secret-token", retry: "claim-connect", operation: "Claim invitation" }); }
  catch (error) { claimMessage = String((error as Error).message); }
  ok(calls === 3, "a claim retries only failures known to happen before a connection is made");
  ok(/Claim invitation failed at \/claim/.test(claimMessage) && /UND_ERR_CONNECT_TIMEOUT/.test(claimMessage), "errors identify the operation, path, and transport cause");
  ok(!claimMessage.includes("secret-token"), "diagnostics never include the bearer token");

  calls = 0;
  global.fetch = (async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ ok: false, error: "busy" }), { status: 429 });
    return new Response(JSON.stringify({ ok: true, data: { decision: { action: "give_up" } } }), { status: 200 });
  }) as typeof fetch;
  await requestJson("https://example.test", "/assist", { method: "POST", token: "secret-token", body: {}, retry: "idempotent", operation: "Ask assistant" });
  ok(calls === 2, "stateless assistant decisions retry a temporary rate limit");

  calls = 0;
  global.fetch = (async () => { calls++; return new Response(JSON.stringify({ ok: false, error: "server problem" }), { status: 500 }); }) as typeof fetch;
  try { await requestJson("https://example.test", "/claim", { token: "secret-token", retry: "claim-connect", operation: "Claim invitation" }); } catch (_) {}
  ok(calls === 1, "a claim is not replayed after the server returned a response");

  calls = 0;
  global.fetch = (async () => { calls++; throw Object.assign(new Error("connection dropped"), { code: "EAI_AGAIN" }); }) as typeof fetch;
  try { await requestJson("https://example.test", "/complete", { method: "POST", token: "secret-token", body: {}, operation: "Report outcome" }); } catch (_) {}
  ok(calls === 1, "outcome mutations are never replayed automatically");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });

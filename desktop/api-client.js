/**
 * Credential-safe HTTP client for the desktop app.
 *
 * A bare `fetch failed` hid the useful part of the 1.14.1 failure: which
 * request failed and whether DNS, TLS, connection setup, or the server caused
 * it. This preserves that context without ever including the bearer token.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PRE_REQUEST_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function nestedCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return null;
}

function nestedMessage(error) {
  const parts = [];
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const message = String(current.message || "").trim();
    if (message && !parts.includes(message)) parts.push(message);
    current = current.cause;
  }
  return parts.join(": ") || String(error || "unknown error");
}

function contextualError(error, operation, pathname) {
  const code = nestedCode(error);
  const detail = nestedMessage(error);
  const suffix = code ? ` [${code}]` : "";
  const wrapped = new Error(`${operation} failed at ${pathname}: ${detail}${suffix}`);
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
}

/**
 * retry:
 *   read          — safe read-only request; retry transport and 5xx failures.
 *   idempotent    — stateless work such as an AI decision; also retry 429.
 *   claim-connect — state-changing claim; retry only if no connection was made.
 *   none          — completion/mutation; never replay automatically.
 *
 * @param {string} apiBase
 * @param {string} pathname
 * @param {{method?: string, token?: string, body?: unknown, operation?: string, retry?: "read" | "idempotent" | "claim-connect" | "none"}} options
 */
async function requestJson(
  apiBase,
  pathname,
  { method = "GET", token, body, operation = "Followthroo request", retry = "none" } = {},
) {
  const attempts = retry === "none" ? 1 : 3;
  let last;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${apiBase}${pathname}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Followthroo-Client": "desktop",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 401) {
        const error = new Error("Your pairing token was rejected. Copy a fresh one from Followthroo → LinkedIn.");
        error.httpStatus = 401;
        throw error;
      }
      if (!res.ok || json.ok === false) {
        const error = new Error(json.error || `Server returned ${res.status}`);
        error.httpStatus = res.status;
        throw error;
      }
      return json.data;
    } catch (error) {
      last = error;
      const code = nestedCode(error);
      const httpStatus = error && error.httpStatus;
      const retryableRead = retry === "read" && (!httpStatus || httpStatus >= 500);
      const retryableIdempotent = retry === "idempotent" && (!httpStatus || httpStatus === 429 || httpStatus >= 500);
      const retryableClaim = retry === "claim-connect" && PRE_REQUEST_CODES.has(code);
      if (attempt >= attempts || (!retryableRead && !retryableIdempotent && !retryableClaim)) break;
      await sleep(attempt === 1 ? 500 : 1500);
    }
  }

  throw contextualError(last, operation, pathname);
}

module.exports = { requestJson, nestedCode, nestedMessage, contextualError, PRE_REQUEST_CODES };

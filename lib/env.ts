/**
 * Central env access. Nothing throws at import time — every integration reports
 * whether it is configured, so the app boots even with a partial .env.local.
 */

function get(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function num(name: string, fallback: number): number {
  const v = get(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalize a URL env var so a small misconfig can't crash callers with "Invalid URL":
 * take the first entry if comma-listed, trim, prepend https:// only when NO scheme is
 * present (so redis://, rediss://, postgres:// etc. are preserved). Returns undefined
 * if it still isn't a valid URL, so a default / graceful-off can take over.
 */
function url(name: string): string | undefined {
  const raw = get(name);
  if (!raw) return undefined;
  let s = raw.split(",")[0].trim();
  if (!s) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  try {
    new URL(s);
    return s;
  } catch {
    return undefined;
  }
}

export const env = {
  appUrl: url("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  appSecret: get("APP_SECRET"),
  databaseUrl: get("DATABASE_URL"),
  redisUrl: url("REDIS_URL"),

  smtp: {
    host: get("SMTP_HOST"),
    port: num("SMTP_PORT", 587),
    secure: get("SMTP_SECURE") === "true",
    user: get("SMTP_USER"),
    pass: get("SMTP_PASS"),
    from: get("MAIL_FROM") ?? "Followthroo <no-reply@followthroo.com>",
    dkim: {
      domainName: get("DKIM_DOMAIN"),
      keySelector: get("DKIM_KEY_SELECTOR") ?? "default",
      privateKey: get("DKIM_PRIVATE_KEY"),
    },
  },

  twilio: {
    accountSid: get("TWILIO_ACCOUNT_SID"),
    authToken: get("TWILIO_AUTH_TOKEN"),
    whatsappFrom: get("TWILIO_WHATSAPP_FROM"),
  },

  linkedin: {
    clientId: get("LINKEDIN_CLIENT_ID"),
    clientSecret: get("LINKEDIN_CLIENT_SECRET"),
    accessToken: get("LINKEDIN_ACCESS_TOKEN"),
    liAt: get("LINKEDIN_LI_AT"),
  },

  // Agent provider: Anthropic Claude — CLAUDE.md's standing rule for the agent layer.
  // Two models: the main tool-calling loop uses the (configurable, defaults to the most
  // capable) model; reply-intent classification always uses the small/cheap one, since
  // it runs on every inbound reply and doesn't need frontier-model reasoning.
  // Agent provider: OpenRouter, via its Anthropic-compatible endpoint.
  //
  // OpenRouter exposes an "Anthropic Skin" at /v1/messages that speaks the
  // Messages API natively and passes native tool use straight through, so the
  // existing @anthropic-ai/sdk client works against it with only a baseURL
  // change — no second wire format, no translated tool schema.
  //
  // Model ids here are OpenRouter's, which are provider-prefixed
  // ("anthropic/claude-...", "minimax/..."), NOT bare Anthropic ids.
  openrouter: {
    apiKey: get("OPENROUTER_API_KEY"),
    baseUrl: url("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api",
    model: get("OPENROUTER_MODEL") ?? "minimax/minimax-m2",
    classifierModel: get("OPENROUTER_CLASSIFIER_MODEL") ?? get("OPENROUTER_MODEL") ?? "minimax/minimax-m2",
    // The LinkedIn pilot has different requirements from the CRM agent: it reads
    // a page and returns one JSON decision, and it is handed a screenshot once
    // the element list has not been enough — so it needs vision and exact
    // structured output rather than good prose. Separate from OPENROUTER_MODEL
    // so tuning the thing that clicks on real accounts cannot change what writes
    // to leads, or the reverse.
    // Defaulted separately, and NOT to OPENROUTER_MODEL's default: that is
    // "minimax/minimax-m2", which OpenRouter has retired from its free tier and
    // now 404s. Gemini Flash is cheap, fast, and reads an image — which this
    // path needs, because a screenshot is attached once the element list has not
    // been enough.
    pilotModel: get("OPENROUTER_PILOT_MODEL") ?? "google/gemini-2.5-flash",
    // Comma-separated. OpenRouter tries these in order when the primary is
    // unavailable, which is why there is no second provider integration here.
    fallbackModels: (get("OPENROUTER_FALLBACK_MODELS") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
  },

  anthropic: {
    apiKey: get("ANTHROPIC_API_KEY"),
    model: get("ANTHROPIC_MODEL") ?? "claude-opus-5",
    classifierModel: get("ANTHROPIC_CLASSIFIER_MODEL") ?? "claude-haiku-4-5-20251001",
  },

  limits: {
    emailPerHour: num("RL_EMAIL_PER_HOUR", 40),
    linkedinPerDay: num("RL_LINKEDIN_PER_DAY", 20),
    whatsappPerDay: num("RL_WHATSAPP_PER_DAY", 250),
  },
  qstash: {
    url: url("QSTASH_URL"),
    token: get("QSTASH_TOKEN"),
    currentSigningKey: get("QSTASH_CURRENT_SIGNING_KEY"),
    nextSigningKey: get("QSTASH_NEXT_SIGNING_KEY"),
  },

  // Google OAuth — powers "Connect Gmail" sending accounts (gmail.send scope).
  google: {
    clientId: get("GOOGLE_CLIENT_ID"),
    clientSecret: get("GOOGLE_CLIENT_SECRET"),
  },

  // Meta Lead Ads inbound webhook (/api/inbound/meta_lead_ads).
  meta: {
    verifyToken: get("META_VERIFY_TOKEN"),
    appSecret: get("META_APP_SECRET"),
    pageAccessToken: get("META_PAGE_ACCESS_TOKEN"),
  },

  // Google Ads Lead Form Extensions inbound webhook (/api/inbound/google_ads).
  googleAds: {
    webhookKey: get("GOOGLE_ADS_WEBHOOK_KEY"),
  },

  // IndiaMART's separate historical-backfill key (scripts/indiamart-backfill.ts) —
  // distinct from the Push webhook's ingest key, generated on the same Lead Manager page.
  indiamartPull: {
    apiKey: get("INDIAMART_PULL_API_KEY"),
  },

  // Reseller storefront (Wild West Domains, white-labelled). Not a secret: the
  // private-label id travels in a public URL and is what credits the sale to us,
  // so it is safe in a client bundle and defaults to the live storefront rather
  // than disabling the feature when unset.
  storefront: {
    plid: get("RESELLER_PLID") ?? "601578",
    baseUrl: get("RESELLER_STOREFRONT_URL") ?? "https://www.secureserver.net",
  },
};

export const configured = {
  db: !!env.databaseUrl,
  redis: !!env.redisUrl,
  email: !!(env.smtp.host && env.smtp.user && env.smtp.pass),
  whatsapp: !!(env.twilio.accountSid && env.twilio.authToken && env.twilio.whatsappFrom),
  linkedin: !!(env.linkedin.accessToken || env.linkedin.liAt),
  // Either provider satisfies the agent — OpenRouter wins when both are set.
  agent: !!(env.openrouter.apiKey || env.anthropic.apiKey),
  anthropic: !!(env.openrouter.apiKey || env.anthropic.apiKey),
  openrouter: !!env.openrouter.apiKey,
  qstash: !!(env.qstash.url && env.qstash.token),
  google: !!(env.google.clientId && env.google.clientSecret),
  meta: !!(env.meta.verifyToken && env.meta.appSecret && env.meta.pageAccessToken),
  googleAds: !!env.googleAds.webhookKey,
  // The storefront needs no credentials, so the feature is on by default.
  storefront: !!env.storefront.plid,
};

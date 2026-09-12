/**
 * Trending topics for a post: Google News RSS, Google Trends' daily RSS, and
 * OpenRouter's web-search plugin, clustered into a handful of topic cards by a
 * cheap model.
 *
 * Each source degrades independently — an RSS feed timing out, or the web
 * search plugin not being available through the Anthropic-compatible endpoint
 * (checked once, noted below), should narrow what's found, never throw and
 * block the whole autopilot run over one flaky source.
 */
import { env, configured } from "../env";

export interface TopicSource {
  title: string;
  url: string;
}

export interface TopicCard {
  topic: string;
  why: string;
  sources: TopicSource[];
}

const FETCH_TIMEOUT_MS = 8000;

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; FollowthrooBot/1.0)" } });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * The smallest RSS reader that answers "title + link, per item" — no
 * dependency, matching this repo's own preference for a hand-rolled parser
 * over a package for a narrow, well-specified format (see
 * scripts/package-extension.ts's ZIP writer). Namespaced tags
 * (news:item, ht:news_item) are read the same as bare ones.
 */
function parseRssItems(xml: string, max = 12): TopicSource[] {
  const items: TopicSource[] = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const decode = (s: string) =>
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && items.length < max) {
    const block = m[1];
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1];
    const link = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block)?.[1];
    if (title && link) items.push({ title: decode(title), url: decode(link) });
  }
  return items;
}

/** Recent news mentioning the query. Google News RSS is unofficial but stable and needs no key. */
async function fromGoogleNews(query: string, geo = "IN"): Promise<TopicSource[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}+when:7d&hl=en-${geo}&gl=${geo}&ceid=${geo}:en`;
  const xml = await fetchText(url);
  return xml ? parseRssItems(xml) : [];
}

/** Google Trends' own daily-trends RSS, filtered to items relevant to the query's words. */
async function fromGoogleTrends(query: string, geo = "IN"): Promise<TopicSource[]> {
  const url = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`;
  const xml = await fetchText(url);
  if (!xml) return [];
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const all = parseRssItems(xml, 30);
  const relevant = all.filter((i) => words.some((w) => i.title.toLowerCase().includes(w)));
  // Trends is a bonus signal, not the point — if nothing matches the query, contribute nothing
  // rather than a handful of unrelated headlines dressed up as "trending".
  return relevant.slice(0, 8);
}

/**
 * OpenRouter's web-search plugin, through its Anthropic-compatible endpoint —
 * used everywhere else in the codebase for the agent loop (lib/agent.ts). If
 * the plugin isn't honoured there, this falls back to OpenRouter's own
 * chat-completions endpoint for this one call, per the plan's own note to
 * check first and fall back if needed.
 */
async function fromOpenRouterSearch(query: string, hashtags: string[]): Promise<TopicSource[]> {
  if (!env.openrouter.apiKey) return [];
  const prompt = `Recent, specific news or discussion about: ${query}${hashtags.length ? ` (${hashtags.map((h) => `#${h}`).join(" ")})` : ""}. List sources only.`;
  try {
    const res = await fetch(`${env.openrouter.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openrouter.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.openrouter.model,
        plugins: [{ id: "web" }],
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS + 4000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      choices?: { message?: { annotations?: { url_citation?: { url?: string; title?: string } }[] } }[];
    };
    const annotations = json.choices?.[0]?.message?.annotations ?? [];
    return annotations
      .map((a) => a.url_citation)
      .filter((c): c is { url: string; title?: string } => !!c?.url)
      .map((c) => ({ title: c.title || c.url, url: c.url }))
      .slice(0, 10);
  } catch (e) {
    console.error("[posts/research] OpenRouter web search failed:", e);
    return [];
  }
}

/**
 * Cluster raw sources into 3-5 topic cards with a cheap model. Falls back to
 * one card per distinct headline (capped) if no model is configured — still
 * useful, just less synthesized.
 */
async function clusterTopics(query: string, sources: TopicSource[]): Promise<TopicCard[]> {
  if (!sources.length) return [];
  if (!env.openrouter.apiKey) {
    return sources.slice(0, 5).map((s) => ({ topic: s.title, why: "From recent coverage.", sources: [s] }));
  }
  const list = sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n");
  const prompt = `You're finding LinkedIn post topics about "${query}" from these recent sources:\n${list}\n\nGroup them into 3-5 distinct topic cards. Reply with ONLY a JSON array, no prose: [{"topic": "short topic name", "why": "one sentence on the angle for a LinkedIn post", "sourceIndexes": [1,2]}]`;
  try {
    const res = await fetch(`${env.openrouter.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openrouter.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.openrouter.classifierModel, messages: [{ role: "user", content: prompt }], max_tokens: 800 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS + 4000),
    });
    if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "[]";
    const match = raw.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : raw) as { topic: string; why: string; sourceIndexes: number[] }[];
    return parsed
      .map((c) => ({
        topic: c.topic,
        why: c.why,
        sources: (c.sourceIndexes ?? []).map((i) => sources[i - 1]).filter(Boolean),
      }))
      .filter((c) => c.topic)
      .slice(0, 5);
  } catch (e) {
    console.error("[posts/research] clustering failed, falling back to one card per source:", e);
    return sources.slice(0, 5).map((s) => ({ topic: s.title, why: "From recent coverage.", sources: [s] }));
  }
}

/** Find 3-5 trending-topic cards for a query, from all three sources at once. */
export async function findTrendingTopics(query: string, hashtags: string[] = [], geo = "IN"): Promise<TopicCard[]> {
  const [news, trends, web] = await Promise.all([
    fromGoogleNews(query, geo),
    fromGoogleTrends(query, geo),
    fromOpenRouterSearch(query, hashtags),
  ]);
  const seen = new Set<string>();
  const merged = [...web, ...news, ...trends].filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
  return clusterTopics(query, merged);
}

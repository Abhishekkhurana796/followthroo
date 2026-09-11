import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://followthroo.com";
  const now = new Date();

  const routes = [
    { url: "", priority: 1.0, changeFrequency: "daily" as const },
    { url: "/pricing", priority: 0.9, changeFrequency: "weekly" as const },
    { url: "/channels", priority: 0.9, changeFrequency: "weekly" as const },
    { url: "/sequences", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/templates", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/crm", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/ai-agent", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/extension", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/desktop", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/rate-limits", priority: 0.7, changeFrequency: "monthly" as const },
    { url: "/about", priority: 0.7, changeFrequency: "monthly" as const },
    { url: "/contact", priority: 0.7, changeFrequency: "monthly" as const },
    { url: "/blog", priority: 0.7, changeFrequency: "weekly" as const },
    { url: "/careers", priority: 0.6, changeFrequency: "monthly" as const },
    { url: "/status", priority: 0.6, changeFrequency: "daily" as const },
    { url: "/changelog", priority: 0.6, changeFrequency: "weekly" as const },
    { url: "/changelog/desktop", priority: 0.5, changeFrequency: "weekly" as const },
    { url: "/changelog/extension", priority: 0.5, changeFrequency: "weekly" as const },
    { url: "/docs", priority: 0.8, changeFrequency: "weekly" as const },
    { url: "/api-reference", priority: 0.8, changeFrequency: "monthly" as const },
    { url: "/security", priority: 0.6, changeFrequency: "monthly" as const },
    { url: "/gdpr", priority: 0.6, changeFrequency: "monthly" as const },
    { url: "/extension-privacy", priority: 0.4, changeFrequency: "monthly" as const },
    { url: "/privacy", priority: 0.5, changeFrequency: "monthly" as const },
    { url: "/terms", priority: 0.5, changeFrequency: "monthly" as const },
  ];

  return routes.map((r) => ({
    url: `${baseUrl}${r.url}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}

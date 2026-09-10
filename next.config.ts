import type { NextConfig } from "next";

/**
 * Security headers on every response.
 *
 * None were set before 2026-09-10. These are the ones with no plausible
 * downside: HTTPS pinned for a year, no MIME sniffing, no referrer carrying a
 * lead's dashboard URL to another site, no camera, microphone or location, and
 * no framing by other sites. The desktop app shows the web app in a
 * WebContentsView, which is not a frame, so the framing rules do not touch it.
 *
 * The Content-Security-Policy is report-only for now. The app loads fonts,
 * charts and inline styles from several places, and an enforcing policy that is
 * wrong breaks the product for every customer at once. Tighten it into an
 * enforcing header once the browser console is clean of reports.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy-Report-Only", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "https", hostname: "d8j0ntlcm91z4.cloudfront.net" },
    ],
  },
  // Server-only packages that should not be bundled for the browser.
  serverExternalPackages: ["twilio", "nodemailer", "bullmq", "ioredis", "@prisma/client"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

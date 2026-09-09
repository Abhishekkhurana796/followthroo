import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/dashboard/ThemeProvider";

export const metadata: Metadata = {
  title: "Followthroo — Multi-Channel Outreach",
  description:
    "AI-powered outreach across email, LinkedIn, WhatsApp, and social — one clear, consistent story.",
  applicationName: "Followthroo",
  creator: "brandstac",
  publisher: "brandstac",
};

export const viewport: Viewport = {
  // Matched to --canvas in each theme so the browser chrome doesn't disagree
  // with the page behind it.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Resolves the theme before first paint, so a dark-mode user never sees a white
 * flash. Reads a cookie rather than localStorage so server components can see
 * the same value, and stays static markup so this layout — and every marketing
 * page under it — can still render statically.
 */
const THEME_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )ft-theme=([^;]*)/);
var p=m?decodeURIComponent(m[1]):'system';
var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
var e=document.documentElement;
e.dataset.themePref=p;
e.dataset.theme=d?'dark':'light';
e.style.colorScheme=d?'dark':'light';
}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* One provider for the whole app. It used to live in DashboardShell,
            which meant the marketing site had no way to change theme at all —
            the tokens were stamped by the script above, but nothing could
            switch them. */}
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

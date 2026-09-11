import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Followthroo — Multi-Channel Outreach Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #0b111e 0%, #131b2e 50%, #172545 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: "80px",
          fontFamily: "sans-serif",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: "#316bff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 30px rgba(49, 107, 255, 0.6)",
            }}
          >
            <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#ffffff" }} />
          </div>
          <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>Followthroo</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "900px" }}>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.2em",
              color: "#4d82ff",
            }}
          >
            Multi-Channel Outreach & Campaign Automation
          </div>
          <div
            style={{
              fontSize: "56px",
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              background: "linear-gradient(90deg, #ffffff 0%, #7091e5 100%)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Reach leads where they reply — Email, LinkedIn & WhatsApp.
          </div>
          <div style={{ fontSize: "24px", color: "#94a3b8", lineHeight: 1.4 }}>
            Unified lead state management, safe LinkedIn automation guardrails, and AI profile prospecting.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            fontSize: "18px",
            color: "#64748b",
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            paddingTop: "24px",
            width: "100%",
          }}
        >
          <span>https://followthroo.com</span>
          <span>•</span>
          <span>GDPR Compliant</span>
          <span>•</span>
          <span>AI Prospecting Agent</span>
        </div>
      </div>
    ),
    { ...size }
  );
}

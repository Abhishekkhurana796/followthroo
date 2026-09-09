/**
 * Build Chrome Web Store screenshots.
 *
 *   npx tsx scripts/extension-screenshots.ts
 *
 * The Store wants 1280x800 or 640x400, JPEG or 24-bit PNG, **no alpha** — an
 * alpha channel is a silent rejection, and it is the easiest mistake to make
 * because almost every screenshot tool writes RGBA by default. Everything here
 * is flattened onto an opaque background and verified before it is written.
 *
 * The UI in these images is the real thing: `store-assets/popup.png` is a
 * screenshot of the actual popup.html running, not a redraw. Nothing here
 * fabricates a LinkedIn page or invents people — see README for the two shots
 * that have to be captured against a real logged-in session.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const W = 1280;
const H = 800;
const OUT = path.join(process.cwd(), "store-assets");

const INK = "#0a0a0a";
const SOFT = "#5b5b66";
const ACCENT = "#4B31E6";
const CANVAS = "#F4F3FA";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Wrap text by character count — close enough at these sizes, and dependency-free. */
function wrap(text: string, perLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > perLine) {
      lines.push(line.trim());
      line = w;
    } else line += ` ${w}`;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

interface Panel {
  file: string;
  kicker: string;
  title: string;
  body: string;
  /** Optional real screenshot to sit beside the copy. */
  image?: string;
  bullets?: string[];
}

function svg(p: Panel): Buffer {
  const titleLines = wrap(p.title, p.image ? 22 : 34);
  const bodyLines = wrap(p.body, p.image ? 40 : 62);
  const left = 88;
  const titleSize = p.image ? 46 : 56;

  let y = p.image ? 190 : 250;
  const title = titleLines
    .map((l, i) => `<text x="${left}" y="${y + i * (titleSize + 10)}" class="t">${esc(l)}</text>`)
    .join("");
  y += titleLines.length * (titleSize + 10) + 18;
  const body = bodyLines
    .map((l, i) => `<text x="${left}" y="${y + i * 34}" class="b">${esc(l)}</text>`)
    .join("");
  y += bodyLines.length * 34 + 26;

  const bullets = (p.bullets ?? [])
    .map(
      (t, i) =>
        `<circle cx="${left + 6}" cy="${y + i * 40 - 6}" r="4" fill="${ACCENT}"/>` +
        `<text x="${left + 24}" y="${y + i * 40}" class="b">${esc(t)}</text>`,
    )
    .join("");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>
    .t{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:${titleSize}px;font-weight:800;fill:${INK}}
    .b{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;fill:${SOFT}}
    .k{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;fill:${ACCENT};letter-spacing:1.6px}
    .m{font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;fill:#fff}
  </style>
  <rect width="${W}" height="${H}" fill="${CANVAS}"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${ACCENT}"/>
  <rect x="${left}" y="86" width="34" height="34" rx="9" fill="${ACCENT}"/>
  <text x="${left + 10}" y="${86 + 25}" class="m">F</text>
  <text x="${left + 48}" y="${86 + 24}" class="k">${esc(p.kicker.toUpperCase())}</text>
  ${title}${body}${bullets}
</svg>`);
}

const PANELS: Panel[] = [
  {
    file: "1-in-linkedin.png",
    kicker: "Followthroo for LinkedIn",
    title: "Add people to your CRM without leaving LinkedIn",
    body: "A checkbox appears beside everyone in a search, with a bar above the list. Tick who you want, or take every result across every page.",
    bullets: [
      "Searches, companies, groups, events, post engagement",
      "Deduplicated against contacts you already have",
      "Assigned to the right rep automatically",
    ],
  },
  {
    file: "2-popup.png",
    kicker: "Your own session",
    title: "We never hold your LinkedIn login",
    body: "It runs inside your own logged-in tab. No password, no session cookie, nothing of yours stored on our servers.",
    image: "store-assets/popup-trimmed.png",
  },
  {
    file: "3-you-send.png",
    kicker: "You stay in control",
    title: "It drafts. You press send.",
    body: "For invites and messages the extension opens the page and fills the box, then stops. Automated sending is against LinkedIn's terms — a real person clicking send is what keeps your account safe.",
    bullets: ["~20 invites a day", "~80 messages a day", "Paced at human intervals"],
  },
  {
    file: "4-limits.png",
    kicker: "Built to last",
    title: "Limits are the feature, not the fine print",
    body: "Daily ceilings are enforced by our servers, not just the extension, and we tell you when LinkedIn changes its layout instead of quietly returning nothing.",
    bullets: [
      "Progress you can watch while it reads",
      "Review before anything becomes a contact",
      "Duplicates flagged before you import",
    ],
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  for (const panel of PANELS) {
    const layers: sharp.OverlayOptions[] = [{ input: svg(panel) }];

    if (panel.image && fs.existsSync(panel.image)) {
      // Scale the real popup up and drop it on the right, on a soft card.
      // Rounded corners so it reads as a floating popup rather than a pasted
      // rectangle, and a size that fills the right half without crowding it.
      const w = 500;
      const base = await sharp(panel.image).resize({ width: w }).png().toBuffer();
      const bm = await sharp(base).metadata();
      const shot = await sharp(base)
        .composite([
          {
            input: Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${bm.height}"><rect width="${w}" height="${bm.height}" rx="16" fill="#fff"/></svg>`,
            ),
            blend: "dest-in",
          },
        ])
        .png()
        .toBuffer();
      const meta = await sharp(shot).metadata();
      const x = 700;
      const y = Math.round((H - (meta.height ?? 540)) / 2);
      layers.push(
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${(meta.width ?? 470) + 40}" height="${(meta.height ?? 540) + 40}">
              <rect x="6" y="10" width="${meta.width ?? 500}" height="${meta.height ?? 320}" rx="18" fill="#000" opacity="0.12"/>
            </svg>`,
          ),
          left: x - 20,
          top: y - 20,
        },
        { input: shot, left: x, top: y },
      );
    }

    const file = path.join(OUT, panel.file);
    await sharp({ create: { width: W, height: H, channels: 3, background: CANVAS } })
      .composite(layers)
      // 3 channels + flatten: the Store rejects anything with an alpha channel,
      // and this is the step that guarantees there isn't one.
      .flatten({ background: CANVAS })
      .removeAlpha()
      .png({ compressionLevel: 9 })
      .toFile(file);

    const m = await sharp(file).metadata();
    const okSize = m.width === W && m.height === H;
    const okAlpha = !m.hasAlpha && m.channels === 3;
    console.log(
      `${okSize && okAlpha ? "  ok  " : "  FAIL"} ${panel.file}  ${m.width}x${m.height}  ${m.channels}ch  alpha=${!!m.hasAlpha}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`,
    );
    if (!okSize || !okAlpha) process.exitCode = 1;
  }

  console.log(`\nWrote ${PANELS.length} to store-assets/ — 1280x800, 24-bit, no alpha.`);
  console.log("The Store allows 5. Leave a slot for a real capture of the bar on your own LinkedIn search.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

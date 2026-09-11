# design_constraints.md — Followthroo Design System

> Binding design constraints. Every screen must comply.

**Last updated:** 2026-09-11
**Status:** active

---

## 0. Thesis

Followthroo orchestrates multi-channel outreach (Email, LinkedIn, WhatsApp) into
**one synced conversation, safely**. The signature visual motif across the product
is the **connection mark** — two nodes threaded into a single lead. As of
2026-09-11 the palette follows lemlist's real blue-and-white system by deliberate
choice, confirmed live rather than guessed (`getComputedStyle` against
lemlist.com): navy ink instead of black, a vivid royal-blue accent, gradient
primary buttons. Typography (Bricolage / Inter / JetBrains) and the connection
mark itself stay distinctly Followthroo's own — the palette moved, the identity
that isn't color didn't.

## 1. Color

Tokens live in `app/globals.css` under `@theme` — raw values in `:root` /
`[data-theme]`, exposed to Tailwind via the `@theme inline` alias block.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--canvas` | `#fbfbfb` | `#0b111e` | page background |
| `--surface` | `#ffffff` | `#131b2e` | cards, raised panels |
| `--ink` | `#213856` | `#f0f4f8` | primary text, dark panels |
| `--ink-soft` | `#566f8f` | `#94a3b8` | muted body text |
| `--ink-faint` | `#788fae` | `#64748b` | tertiary text (still ≥4.5:1) |
| `--line` | `#e2e8f0` | `#1e293b` | hairlines |
| `--accent` | `#316bff` | `#4d82ff` | brand blue — links, focus, primary marks |
| `--accent-strong` | `#1e50d6` | `#709dff` | accent text on a `-soft` background |
| `--accent-soft` | `#eaf0ff` | `#172545` | tinted section surface, chip fill |
| `--accent-gradient` | `linear-gradient(135deg, #7091e5, #316bff)` | `linear-gradient(135deg, #4d82ff, #2558d9)` | `.btn-primary` fill only |

**Channel colors** (the connection motif's threads and Safety's rate-limit
table only — never a button or body text): email `#d97706` · linkedin
`#0a66c2` · whatsapp `#25d366`. LinkedIn's value matches the badge hardcoded
in `app/dashboard/linkedin/LinkedInClient.tsx`; email has no single official
brand color since the product sends through Gmail, Zoho or plain SMTP.

**60-30-10:** ~60% canvas/white, ~30% ink + line, ~10% accent.
**Accessibility:** ink on canvas ≈ 10:1 (light), ≈ 14:1 (dark). White on
`--accent` ≈ 3.9:1 light / ≈ 2.9:1 dark — **`.btn-primary` only**, where text
is large and bold; never small body copy on a bare accent fill.

## 2. Typography

Deliberate, non-default pairing (avoids the AI-default high-contrast serif):

| Role | Face | Notes |
|---|---|---|
| Display | **Bricolage Grotesque** (`--font-display`) | headlines; tight tracking `-0.02em`, weight 700–800 |
| Body / UI | **Inter** (`--font-body`) | default; 16px base, line-height 1.5 |
| Data / utility | **JetBrains Mono** (`--font-mono`) | eyebrows, limits, metrics, captions |

Loaded via Google Fonts in `globals.css`. Display scale uses `clamp()` for fluid
headlines (e.g. hero `clamp(2.6rem, 6vw, 4.6rem)`).

- **Eyebrows** are mono, uppercase, `0.22em` tracking — they label sections.
- **Gradient text** (`.gradient-text`): navy→accent→navy, animated
  `background-position` on scroll (GSAP). `.gradient-text-dark` is the same
  effect for dark bands (white→periwinkle→white). Use on **one** word per view.

## 3. Motion

- **GSAP + ScrollTrigger** is the animation engine.
- **Hero:** page-load timeline (staggered `.lk-rise`), node pop-in (`back.out`), pulses
  traveling the connection threads (`getPointAtLength`), and gradient-position scroll.
- **ChannelCards:** the 3D card deck is **scroll-driven** — ScrollTrigger `pin` + `scrub`
  scrubs the active card; mouse adds parallax tilt.
- **Sections:** `scrollTrigger` reveals (`y:40, opacity:0`, `power3.out`, small stagger).
- Shared feel: `power3.out` / `power2.out`, once-in, subtle. **No infinite blinking.**
- **Reduced motion:** every component checks `prefers-reduced-motion` and skips
  timelines; CSS also neutralizes animation/transition durations.

## 4. Surfaces & effects

- **Glass** (`.glass` light / `.glass-dark`): blur + saturate + hairline highlight.
  Used on the nav (on scroll), hero card, and the 3D channel cards. `.glass-dark`
  and `.band-dark` are deliberately theme-**invariant** (always dark) — `bg-ink`
  cannot do this job, it inverts in dark mode.
- **Ambient:** `.grid-dots` (subtle navy-tinted dotted grid), `.glow-brand`
  (accent-blue radial glow at top).
- Radii on a scale: pills for buttons (`999px`), `16–32px` for cards/panels.

## 5. Buttons & interaction

- `.btn-primary` = `--accent-gradient` pill, white text, lifts on hover
  (`translateY(-2px)` + a blue-tinted shadow).
- `.btn-ghost` = transparent fill, hairline border, soft shadow for elevation;
  border tints accent-blue on hover. **Stays transparent, not a solid
  surface fill** — `CTA.tsx`'s "Book a demo" button overrides only border and
  text color to white against the dark CTA band, never background, so an
  opaque base here would render as invisible white-on-white text.
- Focus: visible `2px` accent outline (quality floor). Touch targets ≥ 44px.

## 6. Iconography & mark

**Lucide React** throughout. The **connection mark** (`components/site/Mark.tsx`,
shared by Nav and Footer) = two nodes joined by a blue-gradient thread — solid
accent-filled left node, canvas-filled/accent-stroked right node. `app/not-found.tsx`,
`app/sign-in/page.tsx` and `app/sign-up/page.tsx` still carry their own inline
copy of the same shape rather than importing the shared component — a
de-duplication worth doing, not yet done.

## 7. Pages

| Surface | Direction |
|---|---|
| Landing (`/`) | Nav → Hero (connection graph) → ChannelCards (scroll 3D deck) → HowItWorks (earned numbered sequence) → Safety (guardrail stats) → FAQ → CTA + Footer |
| `/extension`, `/desktop` | Standalone pages for each client, same honest-safety pattern: what it does, why it's built the way it is, the real download/install action |
| Dashboard (`/dashboard`) | Light command center; stat tiles + channel cards in brand colors — its own shell, does not use `SiteShell`/Nav/Footer |
| 404 (`not-found`) | On-brand "this lead went cold"; gradient 404; Followthroo nav + footer |

## 8. 10-second review

- [ ] Focal point clear; one gradient-text word max per view.
- [ ] Only Bricolage / Inter / JetBrains, each in its role.
- [ ] 60-30-10; white text only on the accent gradient button, never small body copy.
- [ ] Spacing consistent; cards/pills on the radius scale.
- [ ] Hover + focus states present; reduced-motion respected.
- [ ] Connection mark reads as *the* memorable element; everything else quiet.
- [ ] Any hardcoded hex (not a token) checked against BOTH themes — a literal
  background paired with a token-driven text color (or vice versa) is how a
  chip or button goes invisible the moment someone switches theme.

## History

Superseded 2026-09-11: the palette moved from monochrome-plus-indigo to
lemlist-aligned blue, on the client's explicit direction — see git history
for the prior cobalt/coral "LeadsKonnect" system this replaced. Earlier still,
the bank-card carousel, red S.P.D hero, "Alex West" branding section and
NEXOVA identity were removed as unrelated reference brands; their techniques
(3D depth, scroll reveals, glass) live on in the components above.

---
name: Oneinfo
description: Tactile NFC and QR smart cards with dynamic digital profiles
colors:
  primary: "#112b2b"
  primary-container: "#183b3a"
  accent-lime: "#b9f56a"
  accent-mint: "#d7f4dd"
  interactive-teal: "#27849a"
  neutral-paper: "#fbfaf5"
  neutral-cream: "#f4f0e5"
  neutral-surface: "#ffffff"
  neutral-muted: "#64716d"
  neutral-border: "rgba(17, 43, 43, 0.16)"
  status-success: "#50bb81"
  status-warning: "#e9ad55"
  status-error: "#8d352a"
typography:
  display:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "5.5rem"
    fontWeight: 760
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: "3.2rem"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0em"
  label:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "0.14em"
rounded:
  xs: "7px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  full: "100px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "28px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.xs}"
    padding: "13px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.xs}"
    padding: "13px 20px"
  button-accent:
    backgroundColor: "{colors.accent-lime}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: "10px 18px"
  card-panel:
    backgroundColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "24px"
  input-field:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "11px 12px"
  badge-pill:
    backgroundColor: "{colors.neutral-cream}"
    textColor: "{colors.primary}"
    rounded: "{rounded.full}"
    padding: "5px 12px"
---

# Design System: Oneinfo

## Overview

**Creative North Star: "The Tactile Architect"**

Oneinfo bridges durable, precision-engineered hardware with warm, modern editorial craft. Inspired by matte architectural paper, deep forest inks, and the tactile snap of physical business cards, the visual language balances grounded substance with electric digital immediacy. The surfaces avoid generic corporate SaaS sterility; instead, they evoke a workshop of considered materials where every printed millimeter and encoded byte is deliberate.

Across both public commerce surfaces and back-office workstations, the visual density adapts with purpose: the public storefront is generous, physical, and atmospheric, while the operator consoles and administrative spaces are disciplined, scannable, and robust. Physical card renders and high-fidelity 3D assets take center stage, while interface furniture recedes to support fast orientation and clear actions.

**Key Characteristics:**
- **Material Grounding:** Warm paper backgrounds (`#fbfaf5`, `#f4f0e5`) and deep forest inks (`#112b2b`) anchor the experience in physical reality.
- **Electric Telemetry:** Vibrant acid lime (`#b9f56a`) and mint (`#d7f4dd`) serve as high-visibility signal lights for NFC taps, verification badges, and primary calls to action.
- **Tactile Weight:** Generous card corner radii (14px–28px), solid pill action triggers, and deep ambient drop shadows communicate tangible physical objects.
- **Disciplined Precision:** Hairline translucent dividers (`rgba(17, 43, 43, 0.16)`) and monospaced or tracked uppercase labels establish industrial clarity without visual clutter.

## Colors

The Oneinfo palette combines organic paper and forest tones with hyper-modern fluorescent signaling, capturing the intersection of physical printing and contactless wireless hardware.

### Primary
- **Deep Forest Ink** (`#112b2b`): The dominant structural color for headings, primary brand marks, and high-emphasis surfaces. Conveys lasting permanence rather than harsh synthetic black.
- **Ink Container** (`#183b3a`): Dark secondary teal used for hover states, card backdrops, and active sidebar items.

### Secondary
- **Electric Lime** (`#b9f56a`): The high-voltage signal color. Used selectively for NFC tap indicators, active status dots, cart counts, and primary conversion triggers.
- **Soft Mint** (`#d7f4dd`): Tonal tint supporting Electric Lime for subtle highlights, avatar backgrounds, and successful state fills.

### Tertiary
- **Oceanic Teal** (`#27849a`): The interactive focus and administrative accent, applied to workstation links, eyebrow labels, and active input focus rings.

### Neutral
- **Warm Paper** (`#fbfaf5`): The primary canvas background. Softer on the eyes than pure white, evoking premium uncoated stationery.
- **Warm Cream** (`#f4f0e5`): Secondary section fill used to structure alternating narrative blocks and process steps.
- **Pure White** (`#ffffff`): Reserved for elevated cards, active panels, and floating popovers to create clean tonal contrast against paper.
- **Muted Slate** (`#64716d`): Body text, supporting descriptions, and inactive states. Maintains legible contrast without competing with headings.
- **Hairline Divider** (`rgba(17, 43, 43, 0.16)`): Subtle framing border defining panels and table rows without heavy visual division.

### Status
- **Success Mint** (`#50bb81`): Hardware QC pass confirmations, online workstation signals, and verified stock badges.
- **Warning Amber** (`#e9ad55`): Job processing states, retryable NFC writes, and inventory threshold notices.
- **Error Rust** (`#8d352a`): Hardware failure alerts, invalid activation codes, and rejected batches.

### Named Rules
**The Rarity Rule.** Electric Lime (`#b9f56a`) must never cover more than 5% of any view. Its authority comes entirely from contrast against deep ink and neutral paper; overuse destroys its signaling power.

**The Surface Hierarchy Rule.** Dark ink cards float over warm paper, never over deep dark backgrounds without a hairline separation border. Backgrounds transition through tones (`#fbfaf5` → `#f4f0e5`), never through noisy texture overlays.

## Typography

**Display Font:** Arial, Helvetica, sans-serif (Storefront Display)
**Body & UI Font:** Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif (Workstation & Product)
**Label & Mono Font:** Inter / Consolas, monospace

**Character:** Architectural, bold, and authoritative. Display headings feature dramatic negative tracking and tight line heights, evoking Swiss poster design and modern luxury packaging. Technical labels are compact, uppercase, and tracked generously for instant scanning.

### Hierarchy
- **Display** (Weight 760, `clamp(4.2rem, 9vw, 8.8rem)`, line-height 0.98, tracking -0.045em): Hero statements and major storefront claims. Words may feature stroked text outlines (`em` styled with `-webkit-text-stroke`).
- **Headline** (Weight 700, `clamp(2.5rem, 5vw, 4.5rem)`, line-height 1.05, tracking -0.04em): Section headers, modal titles, and card finish names.
- **Title** (Weight 700, 1.25rem–1.55rem, line-height 1.3, tracking -0.02em): Panel headers, product finish titles, and cardholder names.
- **Body** (Weight 400–500, 0.9rem–1.05rem, line-height 1.55–1.68): Descriptive text, process descriptions, and specifications. Max line-length capped at 68ch.
- **Label** (Weight 850, 0.65rem–0.75rem, line-height 1.2, tracking 0.14em, uppercase): Kickers, status badges, table headers, and telemetry metrics.

### Named Rules
**The No-Float Headings Rule.** Headings must never sit isolated above content with equal margin above and below. They always anchor closely to their following copy (bottom margin ≤ 24px) with generous preceding section clearance.

**The Kicker Rule.** Every major section heading must be preceded by an uppercase tracked kicker with a small accent marker or rule (`span` rule in lime).

## Layout

Oneinfo structures information across two spatial models: the narrative grid for the public storefront and the dense cockpit grid for workstations.

- **Page Max Width:** `1280px` (`--page-max-width`) for marketing and storefront; `1440px` (`--workspace-max-width`) for administrative and production consoles.
- **Page Gutters:** Responsive gutter scaling from `20px` to `48px` (`clamp(20px, 4vw, 48px)`).
- **Section Spacing:** Generous breathing room between marketing chapters (`clamp(76px, 10vw, 150px)`).
- **Grid Systems:**
  - Storefront Showcase: Asymmetric two-column split (`1.04fr` copy to `0.96fr` visual scene) collapsing to single-column on mobile.
  - Product Catalog: 3-column equal card grid with balanced 22px gutters.
  - Workstation Dashboard: Fixed 250px navigation rail with a flexible fluid canvas and anchored 36px bottom status bar.

### Named Rules
**The Fixed Bottom Telemetry Rule.** Operator workstations and production screens always anchor a continuous status bar at the bottom viewport edge displaying live device connectivity, network health, and queue latency.

## Elevation & Depth

Oneinfo uses a **Tonal Layering with Ambient Lift** model. Grounded layouts rely primarily on layered neutral surface tones (`--paper`, `--cream`, `--white`) bordered by crisp translucent hairlines. Elevation shadows are reserved for physical card artifacts and floating actionable elements.

### Shadow Vocabulary
- **Card Float Ambient** (`0 24px 80px rgba(17, 43, 43, 0.13)`): Applied to physical card presentations and hero previews, creating the illusion of a card hovering above the desk.
- **Card Hero Deep** (`0 36px 70px rgba(17, 43, 43, 0.28)`): Applied to dark physical cards to render tactile three-dimensional realism.
- **Panel Rest** (`0 8px 25px rgba(20, 48, 68, 0.04)`): Subtle depth on administrative workbench tiles over cool slate backgrounds.
- **Mobile Action Float** (`0 12px 32px rgba(17, 43, 43, 0.18)`): Applied to floating sticky checkout bars and mobile bottom drawers.

### Named Rules
**The Resting Flat Rule.** Functional data tables, form inputs, and status badges remain strictly flat at rest. Shadows must never be applied to generic administrative containers unless they hover or float over underlying content.

## Shapes

The form language balances tactile rounded curves with crisp rectangular discipline.

- **Micro Radii (7px–8px):** Form inputs, action buttons, table cell chips, and technical tags. Communicates software precision.
- **Macro Radii (14px–28px):** Product cards (20px), content panels (14px), and step containers (28px). Evokes modern industrial hardware and handheld devices.
- **Continuous Pill (100px / 999px):** Status badges, cart counters, NFC pulse rings, and primary mobile action buttons.
- **Card Geometry:** Physical card renders maintain the exact ISO/IEC 7810 ID-1 standard aspect ratio of `1.585` with proportional 14px–24px corner curves.

## Components

### Buttons
- **Shape:** Gently rounded rectangular (7px–8px) for desktop utility; full pill (100px) for prominent floating/cart triggers.
- **Primary:** Deep Forest Ink (`#112b2b`) background with crisp white typography. Internal padding `13px 20px`.
- **Hover / Focus:** Translates upward (`transform: translateY(-2px)`) with subtle tone deepening to `#214d4b`. Focus ring displays `3px solid #27849a` with 3px offset.
- **Accent Button:** Electric Lime (`#b9f56a`) background with Deep Forest Ink text, used for critical conversion and hardware trigger moments.

### Cards / Containers
- **Corner Style:** 14px for administrative workbench panels; 20px–28px for marketing finish cards.
- **Background:** Crisp white (`#ffffff`) over paper or slate surfaces, bounded by a 1px hairline border (`rgba(17, 43, 43, 0.16)`).
- **Internal Padding:** Scaled from 20px to 34px depending on content density.

### Inputs / Fields
- **Style:** Clean 1px solid border (`#ccd8dd`), background `#ffffff`, radius 7px–8px, padding `11px 12px`.
- **Focus:** Crisp border color shift to Oceanic Teal (`#27849a`) with ambient ring `0 0 0 3px rgba(39, 132, 154, 0.12)`.
- **Error:** Soft red background (`#fff2ee`), border `#ebc7bf`, text `#8d352a`.

### Status Badges & Pills
- **Style:** Full pill border radius (`100px`), compact padding (`5px 10px`), uppercase 0.65rem–0.72rem text with 0.1em tracking.
- **Variants:**
  - Online / Pass: Soft green background (`#daf3e4`) with emerald text (`#237548`).
  - Pending / Active: Warm cream (`#edf1f2`) with slate text (`#4d6470`).
  - NFC Signal: Electric Lime dot (`#b9f56a`) with pulsing ambient glow.

### Navigation
- **Site Header:** Sticky top navigation with translucent frosted glass backdrop (`rgba(251, 250, 245, 0.9)` with 18px blur) and 1px bottom border.
- **Workstation Sidebar:** Fixed deep navy bar (`#102d42`) with high-contrast active link markers in Electric Lime (`#b8ef66`).

## Do's and Don'ts

### Do:
- **Do** anchor layouts around physical card representations and tactile finishes.
- **Do** use Electric Lime (`#b9f56a`) strictly as an intentional signal for active NFC states, confirmation dots, and primary CTAs.
- **Do** maintain the canonical 1.585 aspect ratio whenever depicting Oneinfo smart cards.
- **Do** pair bold high-contrast display headlines with generously tracked uppercase micro-labels.
- **Do** preserve the tactile paper canvas (`#fbfaf5`) on public storefront views.

### Don't:
- **Don't** use generic vibrant purple/blue gradient fills; stick to rich natural emerald/forest gradients or deep carbon tones.
- **Don't** apply heavy drop shadows to flat administrative tables and data lists.
- **Don't** shrink body copy below 14px on mobile profiles or checkout forms.
- **Don't** crowd touch targets; buttons and interactive card chips must maintain a minimum touch area of 44×44px.
- **Don't** rely on color alone for hardware pass/fail verification; always pair color with clear iconographic and textual status cues.

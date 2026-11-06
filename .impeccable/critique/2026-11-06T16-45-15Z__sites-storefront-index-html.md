---
target: sites/storefront/index.html
total_score: 26
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 3
target_identity: "file:E:\\Ship Studio\\oneinfo_system\\oneinfo_system\\sites\\storefront\\index.html"
target_fingerprint: "sha256:a59176bf614bfbdba6a2dd0bbc1a98edd1874467244c3314d743fc104779f856"
target_path: "E:\\Ship Studio\\oneinfo_system\\oneinfo_system\\sites\\storefront\\index.html"
timestamp: 2026-11-06T16-45-15Z
slug: sites-storefront-index-html
closed: true
---
Method: dual-agent (A: b60e5696-38e1-4a43-94e6-4b75ded4e537 · B: 66057740-4a10-4041-912a-05498f86c47e)

# Design Critique: Oneinfo Storefront
**Target:** `sites/storefront/index.html` (alongside `styles.css` and `app.js`)  
**Surface Mode:** Persuade / E-commerce  
**Evaluators:** Design Director (Subagent A) & Technical Detector Auditor (Subagent B)

---

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|:-----:|-----------|
| 1 | Visibility of System Status | **3 / 4** | Strong cart badges, live telemetry, and 4-step order tracking; minor gap in catalog loading skeleton. |
| 2 | Match System / Real World | **4 / 4** | Natural Bangladeshi courier hierarchy, BDT (`৳`), and physical card-tap mental models. |
| 3 | User Control and Freedom | **3 / 4** | Clean modal exits and clamped steppers; hash-routing can desync pending reservation states on back button. |
| 4 | Consistency and Standards | **2 / 4** | Severe visual fracture: catalog & detail switch to Cupertino grey (`#f5f5f7`), 999px pills, and Apple system fonts. |
| 5 | Error Prevention | **4 / 4** | Exemplary server reservation prior to bKash payment, phone format regex, and live cart price reconciliation. |
| 6 | Recognition Rather Than Recall | **3 / 4** | Sticky checkout summary; swatches lack visible text labels on catalog cards. |
| 7 | Flexibility and Efficiency | **n/a** | Persuade/e-commerce surface; accelerator hotkeys are not applicable. |
| 8 | Aesthetic and Minimalist Design | **3 / 4** | Crisp editorial hero; product detail view is cluttered with stacked redundant media and fake reviews. |
| 9 | Error Recovery | **4 / 4** | Inline accessible error links, network retry controls, and clear bKash post-reservation guidance. |
| 10 | Help and Documentation | **n/a** | Persuade/e-commerce surface; inline contextual tooltips and FAQ accordion suffice. |
| **Total** | | **26 / 32** | **Good (81.3%)** |

*(Applicable maximum: 32 points. Heuristics 7 and 10 scored n/a for Persuade surface).*

---

## Design Specificity Verdict

### LLM Assessment (Subagent A)
**Diagnosis: Split-Brain — Deep Local Craft at the Margins, Generic Apple-Wash in the Core.**
The brand narrative (*"Designed in Bangladesh for modern networking"*, *"Made to be kept, not handed away"*) and the checkout mechanics (district delivery zones, bKash ArisePay TrxID reservations, Cash on Delivery with advance fee) reflect authentic, thoughtful local engineering. However, in `styles.css` (lines 476–493 & 560–615), the catalog and detail sections abandon the warm paper and tactile ink tokens from `DESIGN.md` in favor of sterile `#f5f5f7` Apple Store tech-gadget styling and generic 999px pills. Furthermore, hardcoded fake reviews labeled *"Sample content"* undermine local buyer trust.

### Deterministic Scan (Subagent B)
The automated detector surfaced **42 findings** on `index.html` (39 quality, 3 slop):
- **19 Actionable Bugs:**
  - Severe low-contrast failure: **2.8:1** on hero highlight numbers (`#8b9792` on `#f0f9df` gradient, need 4.5:1).
  - Moderate low-contrast: **4.1:1** on sage experience section descriptions (`#64716d` on `#dceade`).
  - 9 undersized functional UI text occurrences under 11px (e.g. 9.92px–10.4px on highlight numbers and social row).
  - Typographic drift: `Helvetica Neue` and Apple system font overrides on `.products`.
  - Design token drift: unlisted green/mint hexes (`#3fbe76`, `#d4eadc`, `#dceade`, `#abc0ba`).
- **7 False Positives:**
  - 5 cramped-padding warnings on checkout/review overlays caused by headless calculation on `hidden` elements.
  - 1 illustrative multi-shadow icon technique (`box-shadow: 0 18px 0 #dce5df`).
  - 1 tinted deep-ink ambient shadow (`#102d4226`) misclassified as dark-glow.
- **16 Intentional Brand Patterns:**
  - Warm paper (`#fbfaf5`) and cream backgrounds, Arial display typography, and uppercase tracked kicker chips are explicit brand requirements from `DESIGN.md`.

---

## Overall Impression
The Oneinfo storefront has a world-class concept and an extraordinarily thoughtful Bangladeshi e-commerce engine. The hero is striking and tactile. However, as the visitor transitions from reading about the card to actually buying it, the experience stumbles: the warm stationery atmosphere collapses into a generic grey template, fake review cards trigger skepticism, and the product detail page fragments into competing media boxes.

---

## What's Working
1. **Bespoke Localized Commerce Engine:** Native bKash TrxID verification, district-aware courier zone tariffs (Dhaka vs. Outside Dhaka), and Cash on Delivery with upfront advance fee handling.
2. **Tactile Card Mental Model:** The ISO 7810 ID-1 card aspect ratio (1.585), ambient drop shadows, and side-by-side phone previews communicate the product in under 3 seconds.
3. **Defensive Engineering & Error Prevention:** Cart prices re-check against the live API, pending orders prevent double-charging during bKash transfers, and online/offline event listeners automatically resume stalled operations.

---

## Priority Issues (P0–P3)

### [P1] Visual System Fracture in Product Catalog & Detail Pages
- **Why it matters:** In `styles.css` lines 476–493 and 560–615, `.products` and `.product-detail` switch to `--collection-ground: #f5f5f7`, `#1d1d1f`, and 999px pill buttons. This breaks away from `DESIGN.md`'s "The Tactile Architect" system (`#fbfaf5` paper, `#112b2b` ink, 7px micro-radius buttons), making the conversion surface look like an unbranded third-party gadget store.
- **Fix:** Replace `--collection-ground` with `var(--paper)` and `var(--cream)`. Strip out the `Helvetica Neue` overrides, restore `Inter, Arial, sans-serif`, and align button geometry back to `border-radius: 7px`.
- **Suggested Command:** `/impeccable polish sites/storefront`

### [P1] Synthetic "Sample Content" Reviews Destroying Store Credibility
- **Why it matters:** `app.js` (`reviewsMarkup`) renders three placeholder review cards ("A. Rahman", "N. Sultana", "T. Hasan") with an explicit badge labeled *"Sample content"*. In Bangladesh, where online fraud makes consumers cautious, displaying fake reviews makes the brand appear unproven and untrustworthy.
- **Fix:** Remove the `.review-examples` block. When verified reviews count is 0, display a clean, confident notice: *"No public reviews yet for this finish. Verified cardholders receive an invitation after delivery."*
- **Suggested Command:** `/impeccable distill sites/storefront`

### [P1] Severe Contrast (2.8:1) and Sub-11px Micro-Text Accessibility Failures
- **Why it matters:** The hero highlight numbers (`01`, `02`, `03` in `.hero-points span`) use `#8b9792` over `#f0f9df` radial lime gradient, resulting in an unreadable **2.8:1** contrast ratio (WCAG AA requires 4.5:1). Additionally, 9 functional text elements drop to 9.92px–10.4px, making key badges and social indicators unreadable on mobile screens in bright outdoor light.
- **Fix:** Darken hero highlight numbers to `--ink` (`#112b2b`) or `#4a5754`. Bump all functional micro-text to at least 11.5px–12px (`0.75rem`).
- **Suggested Command:** `/impeccable polish sites/storefront`

### [P2] Dead-End LocalStorage Flow for High-Value Corporate Team Enquiries
- **Why it matters:** The "Oneinfo for Teams" modal (`#team-form`) saves submissions only to browser `localStorage` and tells the user: *"Your team enquiry is saved on this device."* B2B team orders (10–100+ cards) are high-margin sales; failing to dispatch to a backend endpoint or offer an instant WhatsApp concierge abandons qualified corporate buyers.
- **Fix:** Wire `#team-form` to submit to an API endpoint or mailer, and provide an instant one-tap WhatsApp fallback link with pre-populated company and card count details.
- **Suggested Command:** `/impeccable harden sites/storefront`

### [P2] Fragmented Dual Media Hierarchy on Product Detail Page
- **Why it matters:** On `#product-detail`, the layout vertically stacks a 2D photo gallery card (`.product-art`) on top of a 3D model viewer card (`.gallery-model-card`), each with its own redundant variant controls. On mobile, this pushes the price, finish swatches, and "Add to cart" button far down the screen.
- **Fix:** Consolidate media into a single interactive stage with a clean segmented switcher: **[ Photos ]** / **[ Interactive 3D ]**, syncing both seamlessly to the active color swatch.
- **Suggested Command:** `/impeccable shape sites/storefront`

---

## Persona Red Flags

### Jordan (First-Time Buyer in Dhaka)
- **Delivery Timeline Missing:** Checkout computes delivery fees (৳60/৳100), but never states *estimated arrival time* (e.g. "Delivered in 24–48 hours in Dhaka"). Jordan hesitates to order because they don't know if the card will arrive before their upcoming business conference.
- **Compatibility Hesitation:** Jordan worries whether older phones can read the card. Reassurance that the printed QR code works on any camera phone needs to sit immediately next to the "Add to cart" CTA.

### Alex (Power User / Tech-Savvy Cardholder)
- **Missing Hardware Specifications:** Alex wants to see hardware specs (NTAG213 chip type, read range, water resistance, NFC Forum compliance, vCard export format). The product page only lists broad marketing points.
- **Profile Privacy Visibility:** Alex wants to understand whether card profiles can be password-protected or edited freely without subscription fees.

### Sam (Accessibility & Keyboard/Screen-Reader User)
- **Unlabeled Catalog Swatches:** Color swatches in the catalog grid are round buttons with CSS background colors and no visible text labels. Low-vision or color-blind users cannot tell which finish is which without hovering or tabbing.
- **Cart Drawer Focus Trap Missing:** Tabbing past the checkout button in the open cart drawer leaks keyboard focus into the background page behind the overlay.
- **Stroked Text Contrast:** The hollow stroked text in the hero (`.hero h1 em` with `-webkit-text-stroke: 1.5px var(--ink); color: transparent;`) loses contrast on low-contrast screens.

---

## Minor Observations
- The top announcement bar uses a heavy `#081d1d` container that feels visually disconnected from the airy `#fbfaf5` header immediately beneath it.
- In `.faq-list`, the first accordion item touches the top hairline border with zero inset (`padding-top: 0`).
- The `window.addEventListener("online", retryShipping)` listener is excellent defensive design for intermittent mobile connections in Bangladesh.

---

## Questions to Consider
1. *What if the interactive 3D model viewer were the hero experience rather than buried below static images?* An interactive 3D card preview is Oneinfo's biggest visual differentiator over local physical print shops.
2. *Why introduce the gateway name "ArisePay" at payment entry instead of simply "bKash"?* In Bangladesh, bKash is the gold standard for consumer trust; an unfamiliar name increases checkout abandonment.
3. *What if prospective buyers could type their own name and title into the hero phone preview to test their card live before ordering?*

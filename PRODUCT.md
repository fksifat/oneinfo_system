# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Professionals & Networkers:** Founders, executives, sales leaders, freelancers, and creators in Bangladesh who want a reliable, modern way to share contact details, portfolio, and social profiles with zero app installation for the recipient.
- **Corporate Teams:** Companies looking for unified brand consistency across employee cards with central administrative oversight and individual employee profile self-editing.
- **Production Operators:** Factory/workstation operators who batch-generate, encode NFC chips, print QR codes, and execute hardware QC before release.
- **Business Administrators:** Operations and support teams handling customer orders, inventory allocation, and customer lead routing.

## Product Purpose
Oneinfo replaces disposable paper business cards with durable, permanent physical NFC + QR smart cards connected to an editable digital profile. The product covers the complete vertical slice: public marketing storefront, end-to-end hardware encoding and quality control workstation, administrative back-office, and recipient mobile web profiles with instant contact-saving and lead generation.

## Positioning
"Designed in Bangladesh for modern networking."
Unlike generic digital card apps, Oneinfo integrates physical production verification (QC gates requiring both QR checksums and verified NFC read-back) with local Bangladeshi payment/commerce flows (bKash, COD, nationwide courier logistics) and zero-friction recipient web views.

## Operating Context
- **Physical Hand-offs:** Fast-paced networking events, meetings, and trade shows where physical taps or QR camera scans occur in diverse lighting and mobile network conditions.
- **Production Floor:** Workstation PCs running Chrome/Edge app windows connected over secure local Wi-Fi/LAN to Android NFC bridges or USB PC/SC readers.
- **Commerce & Fulfillment:** Integrated storefront handling bKash and Cash on Delivery payments, with automated order status updates and delivery tracking.

## Capabilities and Constraints
- **Hardware Integration:** NTAG213 / NFC Type 2 NDEF URI encoding with read-back comparison; high-contrast printed QR fallback with SHA-256 integrity checks.
- **Storefront & Commerce:** 3D interactive card model viewer (`@google/model-viewer`), shopping cart, coupon codes, and checkout with bKash and COD.
- **Production Workstation:** Transactional batch generation, atomic job claim mechanism, operator session auth, and strict pass/fail QC gating.
- **Digital Profiles:** Public responsive profile view, one-tap vCard (VCF) contact download, direct WhatsApp/phone/email links, and custom portfolio links.
- **Lead Capture & CRM:** Incoming contact lead inbox for cardholders with optional webhook forwarding to CRM systems.

## Brand Commitments
- **Visual Tone:** Minimalist, tactile, premium, and durable.
- **Finishes:** "Essential Black" (matte stealth) and "Essential Light" (clean modern).
- **Core Messages:** "One card. Every connection.", "From first tap to saved contact."

## Evidence on Hand
- Production-ready 3D models (`sites/storefront/public/assets/cards-final/*.glb`).
- Lifestyle photography and studio product renders (`sites/storefront/public/assets/cards-final/`).
- Print-ready card vector SVGs (`output/essential-svg/`).
- Validated technical specification (`Oneinfo_QR_NFC_Production_System_Technical_Specification.docx`).
- 13 PostgreSQL schema migrations and integrated domain test suites.

## Product Principles
1. **Zero Recipient Friction:** The recipient must never be forced to install an application or register to view a profile or save contact info.
2. **Permanent Identity, Dynamic Truth:** Physical card hardware points to an immutable canonical URL, while the profile's digital content can be updated anytime without reprinting.
3. **Rigorous Quality Gate:** No physical card is released to saleable inventory without verified QR generation and confirmed NFC read-back integrity.
4. **Localized for Bangladesh:** Built specifically around Bangladeshi commerce, mobile carrier dynamics, and local payment methods.

## Accessibility & Inclusion
- Dual physical access (NFC tap + optical QR scan) ensures accessibility across both budget smartphones without NFC and modern flagship devices.
- High-contrast, clean typography for public digital profiles and mobile readability.

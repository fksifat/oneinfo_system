# Oneinfo storefront

Editable copy of the static storefront from `../oneinfo-storefront-package.zip`.
The top navbar uses the original Oneinfo transparent SVG from logo kit v4.

From the repository root, run `npm run dev:storefront` and open
<http://127.0.0.1:5175/>.

Orders and team enquiries remain browser-local drafts, as in the original package.

## Product management

Open the control center on port 5174, sign in, then choose **Products**.
Create products as Drafts and edit name/slug, description, features, badge and display order.
Use **Colours & pricing → Add colour** for each colour variant. Each variant has
a stable ID, unique colour name, hex swatch, regular price, optional sale price,
availability, finish, card text style and optional HTTPS image. The first available
colour is selected initially. Up to 40 colours are supported per product.
Publish to include a product in the collection; Archive or Draft hides it.
Highlight puts a published product first with its badge. Within each group,
lower display order comes first. There is no fixed product-count limit in the UI.
Essential and Signature are seeded once by migration 0002; Metal is not seeded.

The API is the source of truth. Prices are integer poisha (100 = ৳1).
Updates include a version to prevent silently overwriting another editor.
Create/update actions are audited; only super admins can write. Auditors can read.
The storefront refreshes on focus and every 30 seconds while visible; it also
refreshes before preparing/saving an order draft. Changed prices and unavailable
products are reconciled in the cart and changes during checkout require review.
Catalog errors show Retry and disable ordering until a successful refresh.

Set `VITE_API_URL` when building against a different API. Add the actual storefront
origin to API `CORS_ORIGIN`. Run `npm run db:migrate` before starting the updated API.
`npm run build` includes the storefront; its output is `sites/storefront/dist`.
Checkout submits orders to the API for processing in Control Center.

## Verification

`npm test` covers product validation; `npm run typecheck` and `npm run build` check
all applications. For the database integration checks, migrate a dedicated test
database, set `DATABASE_URL` to it (its name must end in `_test`), and run
`node scripts/test-products.mjs`. Never point this script at a live database.

## Variant pricing and cart behaviour

Migration 0003 adds variants and backfills the existing finish/price into one
original colour, without inventing discounts or extra inventory. It increments
product versions so an older open editor cannot overwrite the migration.
Legacy product price/appearance columns remain populated from the first variant;
new clients must submit `variants` and use those as the source of truth.

Prices are integer poisha. Regular and sale prices must be positive; sale must
be strictly below regular. Empty sale price means no discount. Storefront cards
show the selected colour's sale price, crossed-out regular price and calculated
percentage: `floor((regular - sale) * 100 / regular)`. Savings below 1% say
“On sale”, avoiding a misleading 0% badge. Admin preview uses the same formula.

Colour switches update the illustration/image, price, discount and finish.
Unavailable colours remain viewable but cannot be added to the cart. Separate
colours of the same product become separate cart lines. Refreshes preserve colour
selection; cart reconciliation updates prices and removes unavailable/deleted
variants without substituting another colour. Legacy carts select the original
colour once. Checkout verifies the displayed product prices and delivery charge before accepting an order.

Availability is a manual switch, not stock quantity tracking or reservation.
Uploaded file storage, scheduled promotions and online payments are outside this catalogue.

## Page width

`packages/layout.css` owns shared layout limits: storefront/production content
is capped at 1280px; the admin workspace at 1440px. Sections keep full-width
backgrounds while adaptive inline padding aligns their content with the navbar
and footer. Product details use a more compact, centered 1120px content width.
Mobile layouts use the available width with responsive gutters.

## Product details

Collection cards link to `#product/<slug>?colour=<variant-id>`. Colour swatches
on the collection change the preview without navigating. The detail view shows
full product information, colour selection and the only product Add to cart
action. Direct links/refresh, browser Back and Back to cards are supported.
Hidden/archived products show an unavailable message. Adding from details refreshes
the catalogue and asks for review if the selected price changed.

The purchase panel shows per-card pricing and savings, named colour choices,
quantity (1–99), a live total, and Add to cart. Colour/media switches preserve
the chosen quantity. Product details use the admin description/features in an
accordion; ordering notes describe the existing local-draft flow. Adding refreshes
prices/availability, prevents duplicate in-flight clicks and rejects a cart line
above 99 instead of silently reducing the requested quantity.

Warranty terms are product-level fields in Admin → Products → Warranty. A
nonempty policy adds a Warranty accordion; empty terms hide it. Demo policies
carry a visible Demo badge and example-only notice. Turn off the demo checkbox
only after entering the final policy. Migration 0004 adds empty defaults without
inventing coverage for existing products. Warranty changes use the same admin
authorization, version checks and audit trail as other product edits.

## Media gallery

Each colour has an ordered `media` array (up to 20 items). Admin offers Add image,
Add video and Add 360° view, captions, remove, and move up/down. There are no
separate front/back inputs. Existing old records are read as image gallery items
until the next admin save. An explicitly empty gallery keeps the card illustration.

- Image: SVG, WebP, PNG or JPG URL.
- Video: direct MP4/WebM URL with optional poster; native controls, no autoplay.
- 360° view: 2–120 image URLs, one per line in rotation order. Drag horizontally
  or use the keyboard-accessible frame slider. These must be real product frames,
  not a single image or a 3D model file.

URLs must be hosted HTTPS or bundled `/assets/` paths. This is a URL-based editor,
not a binary file-upload service. First image, video poster or spin frame is the
collection cover. Empty captions receive image/video/360 labels. Stable catalogue
refreshes preserve video playback and active media. Unavailable media shows an error.

EPS-derived SVG exports are delivered in `output/essential-svg` and the ZIP
`output/essential-original-svg.zip`. Optional matching storefront URLs are
`/assets/essential-svg/02_PRINT_Light_Front.svg` (and the other matching filenames).
These new SVGs are not automatically assigned to the user's product gallery.
Admin resolves bundled image previews from `VITE_STOREFRONT_URL` (default port 5175).

## Gallery proportions and colours

All product media use the same 1600 × 1200 landscape frame. The detail gallery is
capped at 640px wide and scales down on smaller screens. Images and videos use
contain sizing, preserving their original proportions without stretching or
cropping; switching media does not change the frame height. Thumbnails and the
admin preview use the same ratio. Admin image inputs recommend 1600 × 1200 px,
show loaded dimensions and warn about a different ratio or smaller raster image.
SVG remains resolution-independent. Existing image URLs remain valid; warnings
do not block saving. Keep artwork canvas and product scale consistent for the
best visual match across colours and 360° frames.

On desktop, the gallery stays below the sticky navbar while product details
scroll, stopping at the end of the product section. Its width also adapts to the
viewport height so the image and thumbnail strip stay visible together. Narrow
or very short viewports keep the gallery in normal document flow.

All colours' media appear in the detail thumbnail strip by default. Clicking a
thumbnail selects its owning colour, updates the URL/price/cart selection and
opens that media. Selected colour thumbnails are outlined and the active
thumbnail is larger. Admin can select **Gallery thumbnails → every colour /
only this colour** and **Default large preview** for each colour.

Previously uploaded product media is stored in `PRODUCT_MEDIA_DIR` (default `.product-media` under the API working directory). In production, point it to a persistent volume and include it in backups. The storefront loads uploaded media from its configured API origin.

## Checkout and delivery

Checkout supports cash on delivery and full payment through the ArisePay page.
When a payment or COD advance is due, the customer submits a bKash transaction ID
on ArisePay. A super administrator checks the payment before marking it verified.
Checkout returns an order ID. Apply the
checkout database migration before serving the updated API. The **Orders** view
in Control Center lists incoming orders and lets a super administrator update
the three delivery charges. New installs start at ৳60 for Inside Dhaka, ৳100
for Sub-Dhaka, and ৳120 for Outside Dhaka. Orders retain the charges shown at
checkout even when rates are edited later.

The Sub-Dhaka defaults use Savar (including Ashulia), Keraniganj, Gazipur, and
Narayanganj. Checkout checks the full address for suburb names within Dhaka
district and uses the Inside Dhaka rate for other Dhaka addresses. The store records the order for manual
processing in Control Center.

Super administrators can create or deactivate coupon codes in **Orders → Coupons**.
A coupon discounts the items subtotal. Checkout verifies the discount on the
server and keeps it with the order receipt.

For confirmation emails, set `RESEND_API_KEY` and `ORDER_EMAIL_FROM` on the API.
Use a verified sender domain. Checkout shows whether an email was submitted
to Resend after saving the order.

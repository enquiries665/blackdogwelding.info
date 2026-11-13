# BLACKDOG WELDING — NETLIFY + STRIPE

## IMPORTANT: Not live until configured and tested

This is a deployable source package, not a completed live payment service. Order requests and approvals use Netlify Blobs; Stripe Checkout is created by Netlify Functions. There is no email-sending integration: staff must manually copy the private payment link from `/admin.html` and send it to the customer. Orders do not automatically email the workshop, so staff must check the admin page regularly. Add transactional notifications before full commercial launch.

## Deploy via Git (NOT Netlify drag-and-drop)

1. Unzip the archive. The **contents** of this directory must be the repository root (including `netlify.toml`, `package.json`, and `netlify/functions/api.mjs`).
2. Create a **private GitHub repository** and upload the files (do not commit any secrets). Netlify dashboard → **Add new project** → **Import an existing project** → GitHub → choose repository.
3. Build command: leave blank. Publish directory: `.`. Functions directory is set in `netlify.toml`. Netlify installs dependencies from `package.json`.
4. In Netlify → Project configuration → Environment variables add:
   - `ADMIN_TOKEN` = a **long random secret** (32+ random characters), known only to Blackdog staff.
   - `STRIPE_SECRET_KEY` = your **test** Stripe secret key initially (never put it in a webpage, GitHub, or chat).
   - `STRIPE_WEBHOOK_SECRET` = webhook signing secret from Stripe webhook destination.
   - `PUBLIC_URL` = exact HTTPS Netlify site origin, e.g. `https://YOUR-SITE.netlify.app` (no trailing slash).
   Scope variables to Functions, and redeploy after saving them.
5. Stripe Dashboard (test mode) → Developers → Webhooks → Add destination endpoint `https://YOUR-SITE.netlify.app/api/stripe-webhook`; listen for `checkout.session.completed`. Copy the webhook signing secret to Netlify. Test events using Stripe's test mode.
6. Test customer form on `/shop.html`, order list and approval on `/admin.html`, private approved `/pay.html` link, Stripe test card checkout, and payment status after webhook delivery. Do not enable live payments until end-to-end testing passes.
7. When ready, switch Stripe secret key and webhook destination/signing secret to **live mode**, redeploy, and repeat a controlled end-to-end test. Update the `PUBLIC_URL` and webhook URL when moving to `https://blackdogwelding.info`.
8. Only then point DNS at Netlify. Preserve all existing MX, SPF, DKIM and DMARC records for `enquiries@blackdogwelding.info`. Do not cancel Wix until the domain and email work.

## Security / commercial launch checklist

- Orders and tokens are stored in Netlify Blobs (persistent across function invocations). Do **not** use static-file storage or expose admin tokens in the browser source.
- Admin token is typed by staff into `/admin.html` for each session. Use a strong secret and restrict who knows it. A dedicated identity provider with MFA is preferable for a production admin dashboard.
- Payment links are bearer links; send privately and treat as sensitive. Links remain valid to view the approved order even after Stripe Checkout expires. Never share admin URL with token appended.
- Stripe's signed webhook updates paid status; a successful browser redirect alone does not prove payment.
- Set up customer order notifications and a fulfilment process, plus privacy policy, returns/cancellation terms for bespoke goods, company details, and relevant UK consumer compliance before launch.
- Review and test tax treatment, shipping-vs-fitting pricing and VAT registration with your accountant. This prototype applies 20% VAT to the approved total.
- The admin page is **not** a full CRM. No automated emails, fraud controls, rate limiting, customer accounts, or multi-user staff roles are included. Add anti-spam protection to the public request endpoint before promotion.
- Never upload `.env` files or real secret keys into the website ZIP.

## Products

Standard Double Cab Tray: £4,650 + VAT fitted. Shooting Tray & Canopy: £7,850 + VAT fitted. 45L tank £399 + VAT, LED light £55 + VAT each, D-ring £14 + VAT each. Bespoke boxes, non-double-cab configurations and delivery are quoted and approved before payment. Mandatory 3.5-month estimated lead time acknowledgement is required both at request and payment stages.


## Version 2 — spare parts shop and new pages

- `parts.html`: searchable spare parts catalogue, category filters, basket and delivery-only secure Stripe checkout.
- `parts-admin.html`: staff-only create/update/hide parts and view parts orders. Uses existing `ADMIN_TOKEN`. SKU is the unique identifier; changing a SKU creates a different part.
- `gallery.html`, `services.html`, `contact.html`, and a new homepage spare parts call to action.
- `parts-success.html`: customer return page; **payment is verified by Stripe webhook**, not the success redirect.
- Product photographs are uploaded into the repository and referenced by filename or an HTTPS URL. No sample parts or invented prices are published. **Add real SKUs, descriptions, prices and images in the admin page before launching the parts shop.**
- Part prices in admin are **excluding 20% VAT**. The API calculates totals on the server. VAT treatment is a provisional standard-rated assumption to confirm with your accountant.
- Spare parts are delivery-only. Configure the three weight/size shipping tiers below in Netlify; the obsolete flat-rate variable `PARTS_SHIPPING_PENCE` is not used.
- Parts order records and Stripe webhook status are stored in Netlify Blobs. The admin page shows paid orders; fulfilment, refunds, stock control, transactional emails and shipping labels are **not automated**. 'Available' is a manual toggle, not real-time stock. Check stock before advertising; for busy sales add inventory reservations and a fulfilment system.
- Webhook `checkout.session.completed` handles both bespoke trays and spare parts. Configure and test test-mode Stripe webhook and event delivery. A browser success page does not prove payment.
- **Security before public launch:** add bot protection/rate limiting, proper staff authentication with MFA, privacy and trading terms, UK consumer returns policy, delivery terms, company details and automated order notifications. Admin bearer token is a development-stage control only. Protect private staff pages from search indexing.
- Deployment: commit this entire extracted folder to your private GitHub repo, push, and let Netlify deploy automatically. Do not upload the ZIP as a drag-and-drop site because the Netlify Functions must build.
- No live Stripe credentials are included. Do not put secret keys in source files or send them in chat.


## V3: Delivery-only spare parts shipping

Set these Netlify environment variables to your own **EX VAT** rates in pence (example 650 means £6.50 before VAT):
- `PARTS_SHIP_SMALL_PENCE=650` (£6.50 ex VAT; £7.80 inc VAT)
- `PARTS_SHIP_MEDIUM_PENCE=1500` (£15.00 ex VAT; £18.00 inc VAT)
- `PARTS_SHIP_LARGE_PENCE=3500` (£35.00 ex VAT; £42.00 inc VAT)

These are the business-approved charges, not verified courier tariffs. Enter these values in Netlify → Site configuration → Environment variables, with scope including Functions, then redeploy. Each part now requires packed weight (grams) and length/width/height (whole cm) in `parts-admin.html`; update all existing products before enabling checkout. Shipping is calculated server-side using combined actual weight or volumetric weight (volume cm³ / 5000 in kg, whichever is higher), and the longest individual dimension. Small: <=2 kg and <=45 cm; Medium: <=10 kg and <=80 cm; Large: <=20 kg and <=100 cm. Larger orders and missing rates require a manual quotation and cannot pay online. Combined-volume estimation is conservative and does **not** guarantee a courier-compatible packed box; verify actual parcel packaging and courier size limits before live sales. Rates are ex VAT and the existing checkout adds 20% VAT to parts and shipping; confirm correct VAT treatment with your accountant. The site accepts GB addresses through Stripe; if you only deliver to UK mainland, you must validate excluded postcode regions before launch (Stripe country selection alone is insufficient).

Test small, medium, large, oversized and multi-item baskets in Stripe test mode. Redeploy Netlify after adding environment variables. Existing Stripe keys and order functions remain unchanged.

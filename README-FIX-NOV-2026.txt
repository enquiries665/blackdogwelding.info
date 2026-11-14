BLACKDOG WELDING PARTS SHOP FIX

This update prevents /api/parts from returning 500 when Netlify Blobs is not configured. The 13 parts from 2027-parts-catalogue.csv are available as a read-only fallback with accurate EX VAT pricing and 20% VAT displayed in the basket.

IMPORTANT: Parts have NO verified packed weights/dimensions and NO verified photo-to-SKU matches in the supplied CSV. The basket will show products, but checkout deliberately requires a shipping quote until the packed dimensions are entered through the parts admin. The 15 uploaded photos remain in the photo gallery; none have been assigned arbitrarily.

Netlify Blobs remains necessary for parts administration and order records. To enable Stripe checkout, resolve the Netlify Blobs runtime configuration, enter verified dimensions, configure Stripe secrets, and test a full test-mode payment and webhook. Do not accept live orders until these are confirmed.

Deployment: replace the extracted website files in the GitHub repository root, commit and push with GitHub Desktop. Netlify builds automatically. Verify https://blackdogweldinginfo.netlify.app/api/parts returns JSON with 13 items.

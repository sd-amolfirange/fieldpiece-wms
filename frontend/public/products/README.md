# Product images

The 12 PNGs in this folder are Fieldpiece's own official product photos, taken from fieldpiece.com and used here
for **local development / internal demo only** (same basis as `src/assets/brand/README.md`'s logo file).

- Source and provenance for each file: `demo-assets/product-images/SOURCES.md` (source product page, exact image
  URL, and a confirmation that the SKU on the page matches the model code used as the filename).
- Served as static assets at `/products/<MODEL_CODE>.png`; `Model.imageUrl` in the seed data
  (`backend/src/modules/demo/seed-data.ts`, mirrored in `backend/demo-server/src/core/seed.ts`) points at this path
  for any model code listed in `PRODUCT_IMAGES`.
- **[CONFIRM]** Before any customer-facing or production deployment, get Fieldpiece's written sign-off (or their
  own hosted asset URLs / a licensed set) to use these images beyond internal demo purposes.
- A model with no file here (or not listed in `PRODUCT_IMAGES`) falls back to a placeholder icon in the UI — never
  add a broken `<img>` for a SKU without a verified source.

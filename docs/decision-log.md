# Decision log

Significant product and technical decisions for Value CRM. Routine fixes are not listed unless they change agreed behaviour.

When an earlier decision is replaced, it stays here and is marked Superseded.

Historical decision dates are **unknown** where the repository shows the implementation but not a separate agreement date. Those entries were documented on 2026-10-19. Implementation commits are cited when git records them.

## DEC-001

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Host the internal application on Cloudflare Workers static assets, with Supabase for the database, authentication, and row-level security.
- Reason: Staff need one shared system for clients, vendors, products, and proforma invoices without running an ERP. The first version was built as a React and Vite frontend against the Value CRM Supabase project.
- Consequences or limitations: The service-role key stays off the client and out of Wrangler. The project had not been deployed when this entry was first documented; it has since been deployed to Cloudflare Workers. The production URL is not recorded in this repository. Verifications and Value-Website are separate Supabase projects and are not part of this application.
- References: `README.md`, `wrangler.jsonc`, `worker/index.ts`, commit `cb524eb` (2026-10-18, "Add the first version of Value CRM.")

## DEC-002

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Offer exactly three company presets: Egypt — EGP, UAE — USD, and UAE — EUR.
- Reason: Those are the offices and currencies on the reference workbooks. Office and currency are fixed identity, not records staff can add or remove.
- Consequences or limitations: A PI uses one preset. There is no currency conversion. UAE USD and UAE EUR share the UAE legal entity and use different bank accounts. A bank charge is optional on each PI; the workbook instruction to add a fixed 72 USD or 72 EUR charge is not part of the presets.
- References: `README.md` company presets, `public.company_presets`, commit `cb524eb` (2026-10-18)

## DEC-003

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Number Egypt and UAE separately, and keep every issued revision.
- Reason: Each office has its own sequence. UAE USD and UAE EUR share the UAE sequence. A revision must not reuse or discard the previous issued document.
- Consequences or limitations: Numbers look like `EG-2026-00001` and `AE-2026-00001`. The year comes from the PI date and the counter resets each year. Revisions are R1, R2, and so on, on the same base number. Issued office, currency, and year cannot be changed; the PI is duplicated instead. Issued versions cannot be deleted.
- References: `private.allocate_serial`, `private.generate_pi`, `private.create_pi_revision`, commit `cb524eb` (2026-10-18)

## DEC-004

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Require a lead salesperson on every issued PI, and record the preparer automatically.
- Reason: The customer document shows who is responsible for the sale and who issued it. The preparer must be the signed-in user at generation time, not a name typed on the draft.
- Consequences or limitations: The lead must be one of the assigned salespeople. Additional salespeople stay internal. The preparer is `auth.uid()` inside `generate_pi` and is copied into the snapshot. Later changes to a user's name do not change an issued snapshot.
- References: `private.assert_pi_ready`, `private.build_snapshot`, commit `cb524eb` (2026-10-18)

## DEC-005

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Default a new PI's date to the current day in Cairo, and default the expiry to the same day in the next calendar month.
- Reason: Staff were entering those dates by hand, and the commercial default is one calendar month rather than a fixed number of days.
- Consequences or limitations: The dates are still editable on the draft. February and month-end dates follow the calendar month, not 30 days. The implementation landed on 2026-10-18; the agreement date was not recorded separately.
- References: `supabase/migrations/20261018133347_pi_default_cairo_dates.sql`, commit `7ebdcb0` (2026-10-18, "Default new PI dates to the Cairo day and one calendar month.")

## DEC-006

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Model names are unique across the catalogue, including archived products. Comparison ignores capitalisation and surrounding spaces.
- Reason: A model is the catalogue identity. Two spellings that differ only by case or surrounding spaces are the same product.
- Consequences or limitations: The saved spelling is what a PI shows. Existing rows were not renamed or merged. The implementation landed on 2026-10-18; the agreement date was not recorded separately.
- References: `supabase/migrations/20261018143000_product_model_identity.sql`, `src/lib/model-identity.ts`, commit `1fb2b58` (2026-10-18)

## DEC-007

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: PI lines use saved catalogue products, and every product has a vendor. Staff do not create a product that exists only on one PI.
- Reason: Issued documents need a real catalogue item and an active vendor. A line can still be added without leaving the PI, by creating a catalogue product there.
- Consequences or limitations: A draft line that has no matching product cannot be saved again or generated until someone selects or creates a product. The migration did not fill those lines in and did not change issued snapshots. Vendor is not edited independently of the product.
- References: `supabase/migrations/20261018143000_product_model_identity.sql`, `src/components/CreateCatalogueProduct.tsx`, commit `1fb2b58` (2026-10-18)

## DEC-008

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: Description, unit, quantity, and selling price on a PI line can be edited for that PI only.
- Reason: A quotation often needs wording or a price that differs from the catalogue default. Changing the catalogue later must not rewrite the PI, and editing the PI must not rename the product.
- Consequences or limitations: The line starts from the product's vendor, description, unit, and the default selling price for the PI currency. A missing price stays blank and an explicit zero stays zero. There is no currency conversion. Changing the model selects or creates a different product.
- References: `src/pages/PiEditor.tsx`, `private.persist_draft`, commit `1fb2b58` (2026-10-18)

## DEC-009

- Decision date: unknown
- Documented: 2026-10-19
- Status: Implemented
- Decision: New items are added at the bottom of the list, and drag-and-drop order is saved.
- Reason: Staff arrange the commercial document themselves. That order has to survive preview, issue, duplicate, and revision.
- Consequences or limitations: Move up and Move down change the same saved order. An issued snapshot keeps the order from generation. Later reordering of the draft does not change older versions.
- References: `src/components/PiItemSection.tsx`, `pi_lines.position`, commit `1fb2b58` (2026-10-18)

## DEC-010

- Decision date: unknown
- Documented: 2026-10-19
- Status: Superseded by [DEC-011](#dec-011)
- Decision: After issuing a PI, render the PDF in the browser, upload it to the private `pi-pdfs` bucket, and download that stored file afterwards.
- Reason: The first version kept a file next to the snapshot so later downloads did not render again.
- Consequences or limitations: A failed upload left the issued version in place but marked the PDF pending. Retrying the upload required permission to generate PIs. This behaviour is no longer how downloads work. Existing files were not deleted when the decision was superseded.
- References: `supabase/migrations/20261018120100_functions.sql` (`prepare_pdf_retry`, `confirm_pi_pdf` as originally committed), commit `cb524eb` (2026-10-18)

## DEC-011

- Decision date: 2026-10-19
- Documented: 2026-10-19
- Status: Implemented
- Decision: Generate PI PDFs on demand from the immutable issued snapshot. Do not upload generated PDFs to Supabase Storage.
- Reason: The snapshot already contains the issued document. Storing a second PDF file made issuance depend on a browser upload, left versions looking incomplete when that upload failed, and required generate permission for a later download.
- Consequences or limitations:
  - **Generate PI** (originally labelled Generate & Download; see [DEC-012](#dec-012)) still calls `generate_pi`. Numbering, validation, calculation, permissions, and the snapshot are unchanged. The browser renders the returned snapshot and downloads it directly.
  - Downloads of an existing version use that version's snapshot. They do not allocate a number, create a revision, or change the snapshot, dates, or attribution. A person who can read the version can download it without permission to issue a new PI.
  - If rendering fails after the database has issued the PI, the number and version remain. The user is told the PI was issued and can use **Download** on that version. That retry does not issue another document.
  - Rendering dispatches on `layout_version`. `egypt-v1` and `uae-v1` use the current v1 renderer. A new layout must be a new version. An unknown version is an error and is not drawn with another layout.
  - The PDF is built only from the snapshot. Current client, product, user, logo, and bank records are not substituted. Missing snapshot data is reported.
  - Newly rendered bytes are not promised to match an older stored file. Saved content and layout are the contract; PDF metadata may differ.
  - `pdf_status` and `pdf_path` remain legacy columns. New rows are `issued` with a null path. Old `pending` and `ready` rows are not rewritten. The screen no longer describes them as missing or waiting for a file.
  - PDF retry and confirmation functions, and the insert and delete policies on `pi-pdfs`, are removed. The bucket and any existing objects stay until a separate cleanup.
  - Regeneration depends on the saved snapshot. It is not a backup of the database.
- References: `supabase/migrations/20261019080451_on_demand_pi_pdfs.sql`, `src/lib/documents.ts`, `src/lib/pdf.ts`, `src/pages/PiDetail.tsx`, `src/pages/PiEditor.tsx`, [docs/cleanup-pi-pdfs.md](cleanup-pi-pdfs.md)

## DEC-012

- Decision date: 2026-10-19
- Documented: 2026-10-19
- Status: Implemented
- Decision: Show the everyday controls first, and reveal optional controls in labelled sections. A saved or enabled optional value stays visible as a summary when its section is closed.
- Reason: The previous screens showed every filter, item field, adjustment, commercial term, and settings form at once. Preparing a normal PI took too much scrolling and presented too many choices at the same time.
- Consequences or limitations:
  - PIs stay the home page. The sidebar is PIs, Clients, Vendors, Products, and Settings for administrators. There is no dashboard.
  - The PI list keeps search, status, and New PI visible. Office, currency, salesperson, and date range are under Filters, and applied filters stay visible as removable chips.
  - The PI editor is one page: header and client, items, then totals and commercial terms. Office and currency, client, dates, lead salesperson, payment terms, and delivery terms stay visible. Separate shipping details, additional salespeople, discounts and charges, price basis, warranty, and notes open on request.
  - Closing a section does not clear its value. Dates loaded for a draft are not reset by opening a section. Editing PI-specific client text does not change the client record.
  - Item rows are a compact table. Description, quantity, unit, and price are edited on the row. Vendor still comes only from the catalogue product. Move up and Move down are in the row's Reorder menu; drag and drop is unchanged.
  - The primary issue control is labelled **Generate PI**. It still calls `generate_pi` and downloads the PDF rendered in the browser from the returned snapshot. Numbering, revisions, snapshots, calculation, and permissions are unchanged.
  - Issued PI actions other than the latest Download are grouped under More actions. Every issued version remains downloadable from Version history.
  - Settings shows one area at a time: company and bank presets, default terms, or users. Only the selected company preset's form is shown. User permissions are unchanged and are still enforced on the server.
- References: `src/components/Shell.tsx`, `src/components/ui.tsx`, `src/pages/PiList.tsx`, `src/pages/PiEditor.tsx`, `src/pages/PiDetail.tsx`, `src/pages/Settings.tsx`, `README.md`


## DEC-013

- Decision date: 2026-10-19
- Status: Implemented
- Decision: Enable Cloudflare branch previews with a top-level empty `previews` block, and build with Vite before running `wrangler preview`.
- Reason: Review an unmerged UI branch at a preview URL while production remains on main.
- Consequences or limitations: Production continues to use `wrangler deploy`. The generated configuration must retain the preview block and built assets directory. A preview configured with the production Supabase URL shares live data; it is not a separate test database. Preview invitation/reset redirects require allowlisting.
- References: `wrangler.jsonc`, README branch previews, PR #6.


### DEC-013 implementation follow-up — 2026-10-19

Use `npm run build:preview` for preview builds. The script follows Vite's deploy-config redirect and ensures the generated configuration has a `previews` object, because the hosted preview repeatedly reported that block missing. It preserves all existing settings and validates built assets. Production keeps `npm run build` and `npx wrangler deploy`. Verified the build and a simulated missing-block repair locally; no preview was published by the agent.

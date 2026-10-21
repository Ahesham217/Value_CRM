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

## DEC-014

- Decision date: 2026-10-19
- Documented: 2026-10-19
- Status: Implemented
- Decision: Present a draft PI as one document on a light neutral page, with a restrained blue accent and shared control sizes, while keeping everyday fields visible and optional fields behind labelled actions.
- Reason: The first compact layout still looked like separate form cards, with uneven spacing and weak alignment. Staff need the same interaction model in a more deliberate business-document layout.
- Consequences or limitations:
  - The editor keeps office, dates, client, lead salesperson, items, payment, delivery, and totals on one white surface. Shipping and reference, additional salespeople, discounts and charges, and further terms stay optional.
  - Applied optional values remain visible as summaries. Closing a section does not clear its value.
  - Save draft stays explicit. The screen says “Draft saved” only after a successful save, and “Unsaved changes” after a later edit. There is no autosave.
  - Lists, detail, catalogue forms, settings, and sign-in use the same type scale, control height, and surface treatment. PDF rendering is unchanged.
  - The Value Technologies mark is the application icon and sign-in mark. It is not written into invoice data or PDFs.
- References: `src/index.css`, `src/components/Shell.tsx`, `src/components/ui.tsx`, `src/pages/PiEditor.tsx`, `src/pages/PiItemSection.tsx`, `public/favicon.png`, `public/brand-logo.png`


### DEC-013 implementation follow-up — 2026-10-19

Use `npm run build:preview` for preview builds. The script follows Vite's deploy-config redirect and ensures the generated configuration has a `previews` object, because the hosted preview repeatedly reported that block missing. It preserves all existing settings and validates built assets. Production keeps `npm run build` and `npx wrangler deploy`. Verified the build and a simulated missing-block repair locally; no preview was published by the agent.


## DEC-015

- Decision date: 2026-10-19
- Status: Implemented
- Decision: Customer PI PDFs label the assigned lead salesperson's name and phone as **Contact person** and do not print **Prepared by** or the preparer's name.
- Reason: The customer needs a contact, while preparation attribution is for internal records.
- Consequences or limitations: Lead assignments, permissions, preparer attribution, and immutable snapshots remain unchanged. This explicitly supersedes the customer-visible preparer part of DEC-004 and is an intentional presentation/privacy exception to the otherwise version-frozen layout policy: previews and regenerated downloads, including older snapshots, use this customer-facing attribution rule. The company contact is not replaced with the client's contact. Previously downloaded PDFs on external devices cannot be altered.
- References: `src/lib/pdf.ts`, `src/lib/pdf.test.ts`, README PDF behaviour.

## DEC-016

- Decision date: 2026-10-19
- Documented: 2026-10-19
- Status: Implemented
- Decision: Show PI history on a saved product, using each issued version's immutable snapshot and each open draft's saved lines. Match new snapshots by product id. Match older snapshots that have no product id only by the saved model.
- Reason: Staff need to see where a product was quoted, to whom, and at what unit price, without treating the current catalogue or the mutable working copy as the issued record.
- Consequences or limitations:
  - The history is on the product page, below the existing product details. It is not shown for a product that has not been saved. Unsaved edits do not change which product is queried.
  - The latest issued revision of a PI is chosen before its lines are matched. If that revision does not contain the product, it is not shown, and an older revision that did contain it is not presented as the current offer. **Include older revisions** adds those earlier issued versions with their own labels and saved prices.
  - An open initial draft and an open revision draft are included from their saved lines. A revision draft is separate from the latest issued version. A closed working copy is not shown as an extra draft. A duplicate PI is its own document. Multiple matching lines in one version stay separate.
  - The displayed figure is the saved quoted unit price before invoice-wide discounts, tax, and charges. The history does not allocate a discount across lines, convert currencies, or calculate net prices, revenue, or margins. Zero stays zero. A missing price stays missing.
  - Issued rows keep that version's saved client, date, model, description, quantity, unit, price, and currency. **PI status** on an issued row is the parent invoice's current tracking status. Draft rows are always drafts. No historical status events are invented.
  - New snapshots store `line_id`, `product_id`, and `position` on each line. The PDF renderer ignores those identifiers. Existing snapshots and PDFs are not rewritten.
  - A line with a product id matches only that id, even if the saved model text differs or matches another product. A line with no product id matches the current catalogue model after trimming and ignoring case. A later rename of that model can leave the old line unmatched. The row says when the match used the model only.
  - Archiving a product or vendor does not remove history.
  - `private.product_pi_history` is security definer, with an empty search path, and calls the existing active-member and `can_read_pi` checks. Rows, counts, and client, currency, and status options use that same authorized set. The public wrapper is security invoker. Anonymous users cannot execute it. The query does not read `product_costs`.
  - Ordering is newest PI date first, then PI number, then latest issued before an open revision draft, then older revisions, then initial drafts, then line position. The database applies the filters and the page size.
- References: `supabase/migrations/20261019150000_product_pi_history.sql`, `src/components/ProductPiHistory.tsx`, `src/pages/ProductDetail.tsx`, `README.md`

## DEC-017

- Decision date: 2026-10-21
- Documented: 2026-10-21
- Status: Implemented. The migration is applied on Value CRM; see the deployment follow-up below.
- Decision: Store a PI payment agreement as structured data and generate the customer wording from that data. Keep legacy payment paragraphs only for drafts and issued snapshots that do not have a schedule.
- Reason: Payment agreements vary, and a free-text paragraph cannot be used later for receipts or reminders without parsing prose.
- Consequences or limitations:
  - A schedule row is a percentage of the final PI grand total, a fixed amount in the PI currency, or the single remaining balance. Percentages are not percentages of a line or of the unpaid balance. EGP, USD, and EUR are not converted.
  - Money uses the existing half-up, two-decimal rounding. Equal instalments put any remainder on the final instalment. A percentage-only schedule must total exactly 100% on its own. Rounded cents that happen to equal the grand total do not make 60% plus 50% valid. Only after the percentages total 100% is a residue of at most one cent per percentage row placed on the final percentage row. A mixed fixed, percentage, and remaining-balance agreement does not have to make its percentages total 100%. A shortfall that is not that rounding residue stays unallocated and blocks issue.
  - An instalment count must be a whole number from 2 to 120. Blank, zero, fractional, negative, and larger counts are validation errors. Preview and `canonical_payment` check the bound before expanding, so an invalid count does not throw or loop.
  - Due rules are a calendar date, a milestone, a number of days or calendar months after a milestone, or before shipment with an optional deadline. Milestone choices are order confirmation, shipment, delivery, commissioning, or a custom milestone with its own identifier and label. A standard milestone with a missing, null, or other code is rejected, including when it is the start of an instalment group. Event dates are not inferred from creating, issuing, or downloading a PI. An unknown event stays unresolved and is not overdue. “Before shipment” is not given a deadline from a later shipment date.
  - `persist_draft` rejects `payment_schedule: null` when the stored draft already has a structured schedule, and it rejects a payload that omits the key in that same case. `generate_pi` uses that save, so neither path can issue the draft as `egypt-v1` or `uae-v1`. A stored null remains a legacy paragraph and can still be saved with null or with the key omitted. Replacing that paragraph with a schedule is one way.
  - Instalments split one row’s amount. Yearly instalments divide that amount across years. They do not create subscription renewals.
  - The database validates and calculates the schedule inside the existing save and issue transaction. Optimistic concurrency is unchanged. Browser amounts and browser wording are ignored.
  - New issued snapshots use `egypt-v2` or `uae-v2` and store the agreement, canonical amounts, instalment lines, known dates, due formulas, and customer text. `egypt-v1` and `uae-v1` snapshots are not rewritten and still render their saved paragraph. Unknown layout versions still fail.
  - A legacy draft can still be issued from its paragraph. Opening or saving it does not erase that paragraph. Replacement with a schedule is explicit. New drafts start with an empty schedule and do not copy `default_terms.payment_terms`.
  - A revision copies the agreement, keeps fixed dates, and recalculates percentage and remainder amounts when the total changes. A duplicate copies rules, assigns new identifiers, and clears fixed dates and before-shipment deadlines.
  - This does not collect payments, send reminders, renew subscriptions, or open an order module. A future collection plan must be activated from one specific accepted issued version. Generating, downloading, or revising a PI must not create another plan or move the active one. A revision must not erase receipts.
  - `20261021180000_payment_schedules.sql` is in the repository. It has since been applied to Value CRM; see the deployment follow-up below. Do not run it again. A structured draft still cannot be saved or issued as a legacy paragraph, and an editor tab that omits `payment_schedule` cannot save a structured draft.
- References: `supabase/migrations/20261021180000_payment_schedules.sql`, `supabase/tests/payment_schedules.sql`, `src/lib/payment-schedule.ts`, `src/components/PaymentScheduleSection.tsx`, `src/lib/pdf.ts`, `README.md`

### DEC-017 deployment follow-up — 2026-10-21

Value CRM already has `proforma_invoices.payment_schedule`, the payment functions, and both legacy and structured invoices. Do not run `20261021180000_payment_schedules.sql` again. The subscription migration below depends on those functions and does not reapply them.

## DEC-018

- Decision date: 2026-10-21
- Documented: 2026-10-21
- Status: Implemented in the repository. The migration has not been applied to Value CRM.
- Decision: Sell one-time products and subscription products on the same PI. A subscription commitment stores the current-year price and the later-year rule. Only the year being invoiced is part of the PI total and the payment allocation. Subscription charges are payable 100% in advance and are not mixed into one-time instalments.
- Reason: The business prices a subscription by the commitment the customer chooses, confirms later years with the vendor, and must be able to allocate a receipt to each current subscription charge without reading a paragraph.
- Consequences or limitations:
  - Products gain `billing_type`, defaulting existing rows to `one_time`. Subscription prices live in `product_commitment_options`: one active option for a product, a whole-year duration, and a currency. The first-year unit price is required. A one-year option has no later-year price or rule. A longer option has a later-year base and either `fixed_annual` or `vendor_confirmed_base_adjustment`. The second rule adds each year's vendor-confirmed adjustment to the original base. It does not compound. EGP, USD, and EUR are not converted. Purchase prices stay in `product_costs`.
  - An option that a draft names is archived, not deleted. A saved draft can still be read after archival. A new selection must use an active option in the PI currency. Catalogue edits after selection do not replace the prices stored on the line.
  - The draft line stores a self-contained agreement: option id, obligation id, product id, duration, currency, current year (Year 1 in this phase), catalogue and negotiated Year 1 prices, later-year base and rule, `adjustment_compounds: false`, and the generated customer sentence. The line's unit price is the negotiated Year 1 price. Quantity is the number of units. Changing Year 1 does not change the later-year base. A one-time line cannot keep an agreement. An incomplete subscription line can be saved and cannot be issued.
  - Schema version 1 schedules remain percentages of the grand total and are not reinterpreted. A draft that gains a subscription must be saved with schema version 2. Until that explicit save, the version 1 schedule is left unchanged. Version 2 percentages apply only to the one-time allocation. Each subscription line is its own advance obligation. A subscription-only PI has no instalment rows. Obligations plus one-time rows equal the unchanged grand total. Future years are excluded.
  - Discounts are apportioned across current line totals. Shipping, installation, and bank charges are apportioned across the discounted totals. Tax uses the saved tax amount and the existing exclusion flags. Rounding is half-up to two decimals. A cent remainder goes to the line furthest from its exact share, then to the earlier line. A final difference from the grand total, no larger than one cent per line, goes to the last line that can accept it. If every discounted line is zero and the grand total is positive, staff must choose subscription or one-time for the residual charges. That choice does not invent a price.
  - Issued documents with schema version 2 use `egypt-v3` or `uae-v3`. The snapshot copies the agreement, the allocation, and the generated sentence. The sentence is not independently editable. Older layout versions still render their own snapshots. PDFs are still rendered on demand. No PDF file is stored.
  - A revision keeps the agreement and recalculates the allocation when prices, quantities, discounts, taxes, or charges change. It does not change earlier snapshots and does not activate a subscription. A duplicate copies the agreement and prices, assigns new line and obligation ids, and keeps the existing fixed-date review behaviour. It does not refresh catalogue prices and does not copy a start date, receipt, or renewal.
  - The database rejects a subscription saved with a null schedule, an omitted schedule key, a version 1 schedule, or a browser billing type that disagrees with the product. An omitted subscription key on a draft that already has an agreement is rejected, so an old editor session cannot clear it. Two subscription lines on the same PI cannot share an obligation id. A duplicate id is rejected on save, with no partial change, and checked again before issue. An ordinary save or revision keeps each line's id. Duplicating the PI assigns a new id to each copied line.
  - An empty one-time payment list is valid when the subscription advance equals the PI total. The editor does not describe that PI as having a zero total and does not offer “No payment due” as a new choice while the total is positive. If the draft was already marked no payment due, including after a zero subscription draft gains a price, the editor still shows a control to turn that mark off without replacing the schedule. One-time rows left on a subscription-only PI are still an error. A PI whose grand total is zero still requires the explicit no-payment schedule.
  - Not implemented in this decision: the start date is the date the Year 1 obligation is fully paid; each customer's anniversary stays on that date, including when a later payment is late; one calendar month before the anniversary, staff are reminded to confirm the next price with the vendor; the vendor confirms it before a renewal PI; that PI includes only the confirmed year; at the end of the commitment, someone reviews it and it does not renew automatically. [DEC-019](#dec-019) later records the payment and the start date. Reminder jobs, vendor confirmation, and renewal PIs are still not implemented.
  - `20261021193000_subscription_commitments.sql` is unapplied. The rollout order is in the README. Pause PI editing, apply this migration to Value CRM, then serve this frontend before editors are opened again. Do not roll the frontend or the payment functions back after a version 2 schedule or a subscription agreement has been saved.
- References: `supabase/migrations/20261021193000_subscription_commitments.sql`, `supabase/tests/subscriptions.sql`, `src/lib/subscription.ts`, `src/lib/pdf.ts`, `src/pages/ProductDetail.tsx`, `src/pages/PiEditor.tsx`, `README.md`

## DEC-019

- Decision date: 2026-10-21
- Documented: 2026-10-21
- Status: Implemented in the repository. `20261021220000_payment_tracking.sql` has not been applied to Value CRM.
- Decision: Track money received against one confirmed issued version. Allocate each receipt to that version's payment obligations. Activate a subscription when its own first-year obligation is fully paid, or by an explicit no-charge action when the obligation is zero.
- Reason: Staff need outstanding balances and a start date that comes from the payment, without turning the PI into an accounting ledger or creating renewal invoices yet.
- Consequences or limitations:
  - **Start payment tracking** is explicit. Generating, downloading, or revising a PI does not create a plan. A draft cannot be tracked. The user confirms the issued version and sees its number and amount first. The PI's commercial status is not changed to Accepted by starting tracking or by recording a payment.
  - One parent PI has one active plan, pinned to the source issued version, currency, agreed total, and obligations copied from that snapshot. Starting again returns that plan. A later revision does not retarget it, erase receipts, or create a second subscription. Plan replacement is not offered.
  - Schema version 1 obligations cover the whole PI. Schema version 2 keeps subscription advances separate from one-time rows and instalments. Instalment identity is the source row and sequence. A legacy payment paragraph is not parsed and stays out of structured tracking. Unresolved event dates and blank before-shipment deadlines are not overdue and are not invented from issue, download, or an unrelated receipt.
  - A receipt is allocated explicitly inside one PI. The allocations must equal the receipt. They cannot exceed an obligation balance or the plan balance. Partial payments are allowed and do not activate a subscription or rewrite the advance agreement. Suggested allocations are visible before save. Currency is not converted. The signed-in user is the audit user. Idempotency stops a double submit. Bank references are not globally unique.
  - Posted receipts are reversed with a reason, not edited or deleted. Reversal restores balances and is safe to repeat. If an activated subscription is no longer fully funded, it remains and is marked payment review required. Its start date is not moved.
  - Activation uses the received date on which the subscription obligation first becomes fully paid. On a mixed PI the machine can still be outstanding. A zero-value subscription requires **Activate at no charge**, with a start date and a reason. Catalogue changes do not rewrite the saved agreement. Issued snapshots do not contain a vendor, so historical vendor identity is left unavailable.
  - Anniversaries are calculated from the original start. A 29 February anchor clamps to 28 February in a non-leap year and returns to 29 February in a later leap year. A one-year commitment has no committed renewal year. Future CPI years are not amounts due.
  - New write permissions default to false for existing members. Administrators have them through `has_flag`. Anyone who can read the source PI can read its plan, receipts, balances, and subscription. Database policies and the write functions enforce that. Browser-supplied user ids are not used for audit.
  - Renewal reminders, vendor price confirmation, and renewal PI generation are not implemented. The planned next phase is an internal reminder one calendar month before the next committed year, vendor confirmation, a renewal PI for that year only, 100% in advance, and a review at commitment end.
  - Checked on 2026-10-21, Value CRM already has the payment-schedule migrations and the subscription commitment objects, while `20261021193000_subscription_commitments` is absent from `schema_migrations`. Do not re-apply that file blindly. `20261021220000_payment_tracking.sql` was not applied. Apply it before deploying this frontend and the admin-users function. It does not replace PI save or issue, so open PI editors can keep working. Do not deploy the admin function before the columns exist if that deploy is changed to require them; the function in this revision omits a payment flag the live profile row does not have. After receipts exist, dropping the tables deletes that history. Snapshots are not rewritten.
- References: `supabase/migrations/20261021220000_payment_tracking.sql`, `supabase/tests/payment_tracking.sql`, `src/lib/payment-tracking.ts`, `src/components/PaymentTrackingSection.tsx`, `src/pages/Subscriptions.tsx`, `README.md`

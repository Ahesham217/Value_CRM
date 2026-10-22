# Value CRM

Internal application for Value Technologies. Staff save clients, vendors, and products, prepare proforma invoices from that information, and download an English A4 PDF. It is not an ERP.

The hosted database is the Supabase project **Value CRM** (`idhqrvrpzlkpyyqlkozl`, eu-west-1) in the Value Technologies organization. Verifications and Value-Website are separate applications and were not modified.

PIs are the home page. A compact sidebar also opens Subscriptions, Clients, Vendors, and Products. Settings is shown only to administrators, and is split into company and bank presets, default terms, and users. A draft is one document: office and currency, client, dates, lead salesperson, items, a payment schedule, delivery terms, and totals. Shipping and reference, additional salespeople, discounts and charges, and the other commercial terms open from quiet actions. A saved value stays visible as a summary when its section is closed. Saving a draft is explicit. On the PI list, search, status, and New PI stay visible. Office, currency, salesperson, and date range are under Filters.

## Project decisions

Significant product and technical decisions are recorded in [docs/decision-log.md](docs/decision-log.md). Update that log when a change affects business rules, architecture, permissions, document generation, or storage.

## Local setup

Requirements: Node.js 22 or newer.

```bash
npm ci
cp .env.example .env.local
# fill in the project URL and publishable key
npm run dev
```

The app is at `http://localhost:5173`.

Other commands:

```bash
npm run typecheck
npm test
npm run build
npx wrangler deploy --dry-run
```

`npm run dev` and `npm run build` use the Cloudflare Vite plugin, so routing matches a Workers static-asset deployment.

## Environment variables

Copy `.env.example` to `.env.local`. Both values are public client configuration and are embedded in the frontend bundle at build time.

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Project API URL, `https://idhqrvrpzlkpyyqlkozl.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_...`). The legacy anon key also works. |

Never put the service-role or secret key in a `VITE_` variable, frontend source, Wrangler vars, or a committed file. The admin edge function reads `SUPABASE_SERVICE_ROLE_KEY` from the Supabase function environment, which the platform injects.

## Migrations

SQL lives in `supabase/migrations` and is the reproducible schema. Older files have been applied to Value CRM. Do not run those again. The payment-tracking file is called out below and has not been applied.

On a new database, run the files in filename order with the Supabase SQL editor or CLI:

```bash
supabase db query --linked -f supabase/migrations/20261018120000_schema.sql
supabase db query --linked -f supabase/migrations/20261018120100_functions.sql
supabase db query --linked -f supabase/migrations/20261018120200_security.sql
supabase db query --linked -f supabase/migrations/20261018120300_egypt_logo.sql
supabase db query --linked -f supabase/migrations/20261018120400_indexes.sql
supabase db query --linked -f supabase/migrations/20261018130500_clear_uae_fixed_bank_charge_notes.sql
supabase db query --linked -f supabase/migrations/20261018133347_pi_default_cairo_dates.sql
supabase db query --linked -f supabase/migrations/20261018143000_product_model_identity.sql
supabase db query --linked -f supabase/migrations/20261019080451_on_demand_pi_pdfs.sql
supabase db query --linked -f supabase/migrations/20261019150000_product_pi_history.sql
supabase db query --linked -f supabase/migrations/20261021180000_payment_schedules.sql
supabase db query --linked -f supabase/migrations/20261021193000_subscription_commitments.sql
supabase db query --linked -f supabase/migrations/20261021220000_payment_tracking.sql
```

The first migration installs `public.rls_auto_enable()` and the `ensure_rls` event trigger. That is the same automatic RLS trigger used on the other Value Technologies projects: every new table in `public` gets row level security. The trigger does not create policies. This repo creates those policies explicitly and also enables RLS in the table statements.

`20261019080451_on_demand_pi_pdfs.sql` is included in the list above and has been applied to Value CRM. It does not rewrite issued snapshots or existing PDF metadata.

`20261019150000_product_pi_history.sql` is included in the list above and has been applied to Value CRM. It stores line and product identifiers on newly issued snapshots and adds the product history query. It does not rewrite older snapshots.

`20261021180000_payment_schedules.sql` has been applied to Value CRM. On 2026-10-21 the project already had `proforma_invoices.payment_schedule`, the payment functions, legacy drafts with a null schedule, and a structured schedule. Do not run that file again.

Checked on 2026-10-21, Value CRM already has the subscription commitment objects (`product_commitment_options`, `pi_lines.subscription_agreement`, and the allocation functions). `supabase_migrations.schema_migrations` does not list `20261021193000_subscription_commitments`. Do not run that file again unless a diff shows one of those objects is missing. It does not rewrite issued snapshots.

`20261021220000_payment_tracking.sql` is in the repository and has **not** been applied. It adds payment plans, obligations, receipts, allocations, and subscription records. It does not rewrite snapshots, backfill receipts, or activate anything that already exists. New payment permissions default to false. See the rollout below.

The payment-schedule rollout has already happened. A structured draft cannot be saved back to a legacy paragraph. Omitting `payment_schedule` on a structured draft is rejected. A draft whose stored schedule is still null can stay a legacy paragraph. Do not set a structured schedule back to null from an old session.

### Subscription commitments

Apply `20261021193000_subscription_commitments.sql` only to Value CRM (`idhqrvrpzlkpyyqlkozl`), and only in this window. Do not re-apply the payment-schedule migration. Do not apply this file to Verifications or Value-Website.

1. Pause PI editing. Ask everyone to close PI editor tabs and not to create, save, or generate a PI until the window ends. An open tab keeps the previous JavaScript after a new build is served.
2. Apply `20261021193000_subscription_commitments.sql`.
3. Serve this frontend immediately, before anyone opens a PI. A new tab or a hard reload must load this build.
4. Resume editing.

Until step 2, this editor can show a commitment that the live database will not store. After step 2, the current payment-schedule editor can still save a one-time PI. It cannot read a schema version 2 schedule. If that older tab saves a draft which already has a subscription agreement or a version 2 schedule, the database rejects the save and leaves the stored agreement unchanged. Close the tab and open the PI again.

Do not roll this frontend back after a commitment or a version 2 schedule has been saved. The previous editor cannot send the agreement. Restoring the previous database functions would ignore that agreement, and the next save could clear it. Before any such row exists, the new columns can remain and the function definitions from `20261021180000_payment_schedules.sql` can be restored. Do not drop the new columns once an agreement has been saved. Do not delete invoices, products, users, or snapshots, and do not reset numbering counters. Issued snapshots are not rewritten, so rolling back the database does not restore a previous wording inside an issued document.

### Payment tracking

Apply `20261021220000_payment_tracking.sql` only to Value CRM (`idhqrvrpzlkpyyqlkozl`). Do not apply it to Verifications or Value-Website. It was not applied by the change that added it.

The migration is additive. It does not replace draft save, PI numbering, or snapshot generation, so a browser tab that is already open can keep editing a PI while the SQL is applied. It does add profile columns and replace `private.has_flag` with the same flags plus three new ones. Existing members stay without those write flags. Administrators already pass `has_flag`.

Order:

1. Apply `20261021220000_payment_tracking.sql`.
2. Deploy the `admin-users` function from this revision. Until that deploy, Settings cannot store the three new checkboxes. Saving a user from an older function does not clear the new columns, because that function does not send them. The function in this revision also leaves a payment flag unchanged when the caller omits it.
3. Serve this frontend. Ask staff to reload. An old tab will not show Subscriptions or Record payment until it loads this build. It can still save a PI.
4. An administrator grants “Manage payment tracking and record receipts”, “Reverse receipts”, and “Activate zero-value subscriptions” only to the people who should have them. Do not grant those write flags to every member.

Do not roll the frontend back after a receipt or subscription exists if you also remove the SQL. The previous screen simply will not show the records. Dropping the new tables deletes receipt and subscription history and cannot be reconstructed from issued PDFs. Issued snapshots are not changed by tracking, receipts, reversals, or activation. If no plan has been started, the new tables and columns can be dropped and `private.has_flag` restored from `20261021193000_subscription_commitments.sql`'s predecessor definition in `20261018120100_functions.sql`, plus any flags added since. Do not delete invoices, products, users, or snapshots, and do not reset numbering counters.

`supabase/tests/payment_tracking_concurrent.sh` and `supabase/tests/payment_tracking_lock_order.sh` commit rows. Run them only on a disposable database, never on Value CRM.

`20261018120300_egypt_logo.sql` stores the logo extracted from `reference-templates/Egypt Template.xlsx`. The UAE workbooks do not contain a logo. If Settings shows no Egypt logo, run that file once in the SQL editor.

Do not run `supabase/seed.optional.sql` against the business database. It is fictional and optional.

## First administrator

There is no public registration and no bootstrap secret in the repository.

1. In the Supabase dashboard, open **Authentication → Providers → Email** and turn off **Allow new users to sign up**.
2. Open **Authentication → Sign In / Up** (or Password security) and enable leaked-password protection.
3. Under **Authentication → Users**, add the first person with an email and password. The database trigger creates an inactive profile, so this person still cannot read company data.
4. In the SQL editor, as the database owner, activate that profile. Replace the email:

```sql
update public.profiles
set
  is_active = true,
  is_admin = true,
  is_salesperson = true,
  pi_visibility = 'all',
  can_edit_drafts = true,
  can_generate_pis = true,
  can_manage_clients = true,
  can_manage_vendors = true,
  can_manage_products = true,
  can_view_purchase_prices = true
where id = (select id from auth.users where email = 'you@valuetechnologies.com');
```

Dashboard SQL runs as `postgres`, which the profile trigger allows. A signed-in member cannot run this update: `profiles` has no update grant for the authenticated role, and a trigger rejects other writers.

## Invitations and password resets

Settings is admin-only. It is organised as Company and bank, Default terms, and Users and permissions. Users calls the `admin-users` edge function, which checks that the caller is an active administrator and then uses the service role.

- **Invite by email** sends Supabase's invite link. On the free plan, the built-in mailer only delivers to addresses you have authorized, and only a small number of messages. For real staff mail, configure custom SMTP under Authentication → Emails.
- **Create with a temporary password** confirms the email immediately. Share the password through a channel outside the app. It is not stored in Value CRM.
- A disabled user keeps their name on issued invoices. The function sets `is_active` false, bans sign-in, and deletes refresh sessions. An access token that has not expired yet still cannot read company rows, because every policy checks the live profile.
- Password reset is on the sign-in page. Add these redirect URLs under Authentication → URL configuration, plus the production origin and its `/reset-password` path. The production URL is not recorded in this repository:
  - `http://localhost:5173`
  - `http://localhost:5173/reset-password`

New profiles start inactive. Even if public signup is left on by mistake, a self-registered person gets no permissions and cannot read data.

## Company presets

There are exactly three presets. Office and currency cannot be added or removed.

| Preset | Company | Currency | Bank |
| --- | --- | --- | --- |
| Egypt — EGP | Value Technologies for Import & Agencies S.A.E. | EGP | Commercial International Bank (CIB) |
| UAE — USD | Value Technologies EMEA FZ-LLC | USD | Arab African International Bank |
| UAE — EUR | Value Technologies EMEA FZ-LLC | EUR | Arab African International Bank |

Identity and bank details were taken from `reference-templates`:

- `Egypt Template.xlsx`
- `Update New proforma invoice USD.xlsx`
- `Arab African International Bank   EURO ACCOUNT.xlsx`

Account numbers, IBANs, and SWIFT codes are stored as text. The UAE legal address is Ras Al Khaimah. The supplier-invoice sentence in the UAE workbooks is not part of this application. The workbook instruction to add a fixed 72 USD or 72 EUR bank charge is not part of the presets. A bank charge is optional and is typed on each PI. The PDF prints that amount only when it is included in the total.

Egypt and UAE are the only PDF layouts. UAE uses the selected USD or EUR preset. A PI cannot be issued until the preset has a company name, address, bank name, account name, account number, IBAN, and SWIFT. Settings shows **Ready to issue** or **Needs configuration**.

Default commercial terms, except the old payment paragraph, are copied onto each new draft and stay editable on that PI. The stored payment paragraph is kept for legacy drafts only. It is not copied onto a new PI and it does not configure the payment schedule. Settings shows it as a legacy paragraph, not as a control for new agreements.

## Proforma invoices

Each item on a draft is a catalogue product. Add it under the last line, search by model, and select it, or create a new catalogue product without leaving the PI if you manage products. Model names are unique across the catalogue, including archived products; comparison ignores capitalisation and surrounding spaces, and the saved spelling is what the PI shows. A one-time line copies the product's vendor, description, unit, and the default selling price for the PI currency. A subscription line copies the vendor, description, and unit, then asks for a commitment in that currency. The Year 1 price comes from the commitment, not from another currency. A missing price stays blank and an explicit zero stays zero. There is no currency conversion. Description, unit, quantity, and the current selling price can then be edited for that PI only. Changing the model selects or creates a different product and clears a commitment that belonged to the previous product. Vendor cannot be changed independently of the product. Brand is not required and is not added to the description.

Drag the row handle, or open the row actions and choose Move up or Move down, to set the order. That order is kept on the draft and used by preview, the issued PDF, duplicates, and later revisions. Older issued versions keep the order they were generated with.

A draft line from before this rule that has no matching product stays on the draft and is marked until someone selects or creates a product. It cannot be saved again or generated until then. The migration does not fill those lines in, and it does not change issued snapshots.

Drafts are editable. **Generate PI** calls the database generation function, which allocates the permanent number and stores version 0 as an immutable snapshot. The browser then renders the PDF from that returned snapshot and downloads it. The PDF is not uploaded. The number looks like `EG-2026-00001` or `AE-2026-00001`. Egypt has one sequence. UAE shares one sequence across USD and EUR. The year comes from the PI date and the sequence resets each year. Allocation is a locked counter inside the database transaction. If rendering or the browser download fails after the database has issued the PI, the number and version stay. The message says the PI was issued and points to **Download** in version history. Trying again from there renders the same snapshot and does not allocate another number or revision.

Issued office, currency, year, and base number cannot be revised. Duplicate the PI when those need to change.

**Create revision** opens the one allowed revision draft. Generating it stores R1, R2, and so on, and keeps every older version. **Duplicate** creates a new draft with no number. Each issued version has **Download**. That renders the version's saved snapshot locally, including versions that were previously marked ready or pending in storage metadata. Download does not require permission to generate a new PI. Someone who can read the version can download it. Someone who cannot read the PI cannot read the snapshot.

Tracking statuses are Draft, Sent, Accepted, and Cancelled. Generating a PDF does not mark it sent. An issued document whose tracking status is still draft is shown as **Issued**. Issued PIs are cancelled, not deleted. Unissued drafts can be deleted.

Two people cannot silently overwrite one draft. Saving sends the draft version the editor loaded. A mismatch asks you to reload.

Totals are calculated in the database with `numeric` rounding, and the editor previews the same rules with `decimal.js`:

1. Round each quantity × unit price to two decimal places, half up.
2. Subtotal is the sum of those line totals.
3. Discount applies to the subtotal. A percentage is 0–100. A fixed discount cannot exceed the subtotal.
4. Net items = subtotal − discount.
5. Add shipping, installation, and bank charge when they are enabled.
6. Tax, when enabled, is the rounded taxable base × tax percentage. The taxable base starts as net items plus the enabled charges. Each charge can be excluded.
7. Grand total = net items + charges + tax.

A blank price is unknown, not zero. There is no currency conversion and no automatic tax determination. Unused adjustments are omitted from the PDF. The VAT-exclusion sentence is omitted when tax is included.

The customer PDF contains the company, client, bill-to, ship-to, the lead salesperson’s name and phone labelled **Contact person**, items, totals, terms, and bank details. The preparer’s name, additional salespeople, purchase prices, and vendors stay internal. Prepared by is still recorded and visible inside the app. This customer-facing attribution rule also applies when re-downloading older issued snapshots; their saved data is not changed. Draft preview and issued download use the same pdfmake renderer. The renderer dispatches on the snapshot's `layout_version` (`egypt-v1`, `uae-v1`, `egypt-v2`, `uae-v2`, `egypt-v3`, or `uae-v3`). An unsupported layout version is reported and is not drawn with a different layout.

New drafts use a structured payment schedule. Percentages are percentages of the PI grand total after discounts, tax, and charges. A fixed amount stays in the PI currency. At most one row is the remaining balance. A row can be split into equal monthly or yearly instalments of that row's amount; the final instalment absorbs rounding so the group still matches the row. Dates are calendar dates, or rules such as “upon delivery” or “one calendar month after delivery”. A before-shipment row can have its own payment deadline. If that deadline is blank, the draft says the deadline is still to be set, and the PDF says “before shipment” without inventing a date from a shipment. The customer wording is generated from the schedule. Staff do not edit that paragraph on its own.

An incomplete schedule can be saved. It cannot be issued until the database can reconcile it to the grand total. A percentage-only schedule must add up to exactly 100% before any cent rounding is considered. If those percentages are exactly 100%, a residue of at most one cent per percentage row is placed on the final percentage row. A schedule that mixes a fixed amount or a remaining balance with percentages does not have to make the percentages themselves add up to 100%; the money still has to match the grand total. The browser totals and wording are not trusted: `generate_pi` calculates the amounts and the customer text again. A zero-total PI can be issued only with an explicit “No payment due” schedule. EGP, USD, and EUR are not converted.

An instalment count must be a whole number from 2 to 120. A blank, zero, fractional, negative, or larger count is a validation error. The preview and the database stop before expanding it. A standard milestone must be order confirmation, shipment, delivery, or commissioning. A missing, null, or other code is rejected for an ordinary payment and for the first date of an instalment group. A structured schedule cannot be saved back to a legacy paragraph. A draft that is still a paragraph can stay that way until someone replaces it with a schedule.

Issued snapshots that use a whole-PI schedule store schema version 1, the agreement, the canonical amounts, instalment lines, known dates, unresolved due formulas, and the customer text. Those snapshots use `egypt-v2` or `uae-v2`. A long agreement is drawn as a payment table. Older `egypt-v1` and `uae-v1` snapshots keep their saved payment paragraph. A legacy draft can still be issued that way until someone replaces the paragraph with a schedule, as long as the PI has no subscription. Duplicating a structured PI copies the amounts and event rules, assigns new row identifiers, and clears fixed dates and before-shipment deadlines so they are reviewed. A revision copies the agreement, keeps those dates, and recalculates percentage and remainder amounts when the total changes. The original issued snapshot is not changed.

Schema version 1 is not reused for a subscription. Adding a subscription asks for an explicit update to schema version 2. Until that update is saved, the old schedule stays a percentage of the whole PI total and the draft cannot be saved with the subscription. Version 2 percentages apply only to the one-time amount. The subscription's current charge is a separate obligation, payable 100% in advance, and it cannot be put on an instalment. A PI that contains only a subscription has no instalment rows. That empty one-time portion is valid: the editor does not treat the PI as a zero total and does not offer “No payment due” as a new choice while the total is positive. Selecting a subscription on a new empty schedule prepares that allocation as part of the selection and says the current charge is payable 100% in advance, without asking for another 100% row. If rows were already entered, or the draft is still a legacy paragraph, one confirmation lists the rows that will be removed or kept. The saved draft does not change merely because the page opened. The confirmed change is stored when the draft is saved. If the draft is already marked that way, staff can turn it off without replacing the schedule. One-time rows left on that PI are still rejected. A PI whose grand total is actually zero still needs the explicit “No payment due” schedule. Each subscription line keeps its own obligation id so a later receipt can be assigned to that charge. The database rejects two lines on the same PI that reuse one id, on save and again before issue. Saving or revising keeps the ids. Duplicating the PI assigns new ones. The customer PDF may describe the advance in one sentence.

The PI total is still calculated exactly as above. Payment allocation does not change it. The current line totals are the weights. The invoice discount is shared across those totals, with any cent remainder going to the line that was rounded furthest from its exact share and, on a tie, to the earlier line. Shipping, installation, and bank charges are then shared across the discounted line totals in the same way. Tax uses the saved tax amount and the same exclusions as the PI: a charge excluded from tax is still part of the line's payment amount, but it is not part of that line's taxable weight. The subscription amounts and the one-time amounts add up to the saved grand total. A final cent, if the parts differ from that total, is placed on the last line that can accept it. Future subscription years are not weights and are not in the total.

If every current line is zero after the discount and the grand total is still positive, the charges cannot be shared by line value. The editor asks whether those charges belong to the subscription advance or to the one-time schedule. That choice does not invent a subscription price. It is required only in that case.

A subscription product has commitment options, maintained by someone who can manage products. An option has a duration in whole years, one currency, a first-year unit price, and, after the first year, a later-year base and one rule: a fixed annual price, or a vendor-confirmed adjustment applied independently to that base. The adjustment does not compound from the previous year. There is one active option for each product, duration, and currency. An option used by a draft is archived, not deleted. Prices are not copied into another currency.

On a PI line, quantity is the number of units. The unit price is the Year 1 price. Years after Year 1 are stored on the line and printed from that saved agreement. They are not added into the line total. Changing the Year 1 price does not change the later-year base. A negotiated price is marked against the catalogue price that was current when the commitment was selected. A later catalogue change does not replace the saved agreement. An archived option remains readable on a draft that already selected it. A new line must use an active option in the PI currency. A one-time line cannot keep a subscription agreement. An incomplete choice can be saved and cannot be issued.

Issued subscription lines are part of `egypt-v3` or `uae-v3`. The snapshot stores the product, the line, the obligation id, the commitment, both prices, the rule, the currency, Year 1, the canonical allocation, and the customer sentence. That sentence is generated from those fields. It is not a separate editable paragraph. The PDF does not print internal ids or purchase prices, and it does not state a final price for a later year before the vendor confirms it. Older layout versions still render their own snapshots.

Product PI history shows the saved Year 1 unit price. It does not add later years or allocate the invoice discount.

**Start payment tracking** pins collection to one issued version the staff member confirms was agreed with the customer. Generating, downloading, or revising a PI does not start tracking, and a draft cannot be tracked. The plan stores the parent PI, the source version, the currency, the agreed total, and the obligations copied from that version's snapshot. It does not rebuild them from the current draft, the catalogue, or company settings. One PI has one active plan. Starting again returns that plan. A later revision does not move it, erase receipts, or create another subscription. The screen says when the latest issued version is different from the tracked one. Replacing a plan is not available.

Schema version 1 obligations are the whole PI, including expanded instalments. Schema version 2 keeps each subscription advance separate from the one-time rows. An instalment's identity is its source row and sequence, not its label. A legacy payment paragraph is not parsed and cannot be tracked. Its display and PDF download stay as they are. A fixed date is stored as agreed. An event without a date stays “Awaiting delivery date”, “Awaiting confirmation date”, or the matching milestone, and is not overdue. “Before shipment” with no deadline stays “Deadline to be set”. Issuing, downloading, or receiving some other payment does not invent a delivery or shipment date. A payment can still be recorded against an obligation whose date is unresolved.

**Record payment** takes the amount, the date received, the method (bank transfer, cash, cheque, or other), an optional reference, an optional note, and an explicit allocation. Typing an unfinished amount, such as a decimal point on its own, does not show an activation date and is not saved. The activation date appears only when the pending allocation is a positive amount in the PI currency with at most two decimal places, and that amount would finish the subscription obligation. The currency is the PI currency. There is no conversion. The person recorded is the signed-in user. A submission id prevents a double submit. Bank references are not required to be unique. Allocations must add up to the receipt, stay inside one PI, and cannot exceed an obligation's unpaid balance or the plan's outstanding balance. A suggested split is shown in document order and is saved only when the user records it. A partial payment reduces the outstanding amount. It does not turn a 100% advance agreement into instalments, and a partial subscription payment does not activate the subscription.

Collection status stays separate from Draft, Sent, Accepted, and Cancelled. Recording a payment does not change that commercial status. Obligations are unpaid, partially paid, or paid. Received money is not labelled as revenue.

**Reverse payment** asks for a reason and keeps the original receipt, who reversed it, and when. Repeating it does not reverse the receipt twice. Balances are restored. The issued snapshot and PDF are unchanged. Correct an amount or allocation by reversing the receipt and recording a replacement. If a reversal means an activated subscription is no longer fully paid, the subscription stays, its start date stays, and it is marked **Payment review required**. There is no editor for the start date.

A subscription is created only from an issued subscription obligation on the active plan. On a mixed PI, that subscription can activate while the machine is still unpaid. The start date is the received date on which non-reversed allocations first cover the obligation, ordered by received date and then by a fixed tie-breaker. It is not the day the PI was created, generated, or the day someone typed a backdated receipt. The screen shows that date before the payment is saved. One source obligation creates one subscription, including after a revision. A zero-value subscription is not activated because zero equals zero. **Activate at no charge** asks for a start date and a reason, and records who did it.

Recording a receipt, reversing one, and activating a zero-value subscription lock the payment plan first and then its obligations in a fixed id order, so those actions can overlap without deadlocking. The subscription stores the client name from the snapshot, the product model and description from the snapshot, the quantity, currency, commitment, Year 1 price, later-year base and rule, and that adjustments do not compound. Issued snapshots do not contain a vendor, so no historical vendor is stored. The product page's current vendor, when shown, is labelled as the current catalogue vendor. Anniversaries are calculated from the original start date. A 29 February start uses 28 February in a non-leap year and 29 February again in a later leap year. A one-year commitment has no committed second year. A three-year commitment ends at the third anniversary, which is an exclusive end and not itself a payment. A late receipt does not move those dates. Future CPI years say **Price pending vendor confirmation** and are not added to the outstanding balance. The base is not shown as an amount due. There is no “renewal paid” state.

Subscriptions are listed from the sidebar. A person sees a subscription only when they can read its source PI. The same PI visibility applies to plans, obligations, receipts, and balances, including counts and filters.

The next phase is not implemented. It is planned as an internal reminder one calendar month before each customer's next committed subscription year, vendor price confirmation, a linked renewal PI for that year only, 100% in advance, and a review at the end of the commitment. There is no reminder job, email, CPI lookup, auto-renewal, payment gateway, bank reconciliation, or accounting ledger.

Generating or downloading a PI does not collect money or send a reminder. The issued PDF is rendered only from the snapshot: client and contact, line order, quantities, units, prices, saved totals, terms, company and bank details, the company contact, dates, and the saved logo. The snapshot retains the preparer for internal records, but that field is not printed. Current client, product, user, logo, or bank records are not read to fill an old document. If a snapshot is missing data the renderer needs, the download stops with that gap instead of substituting current records. Replacing the logo or a catalogue row does not change an issued snapshot.

`pi_versions.pdf_status` and `pdf_path` remain as legacy metadata. New versions are stored as `issued` with no file path. Older rows may still say `pending` or `ready`; the screen does not treat that as a failed download. Previously stored files in the private `pi-pdfs` bucket are left in place. Removing them is a separate step, described in [docs/cleanup-pi-pdfs.md](docs/cleanup-pi-pdfs.md), and it has not been run.

A newly rendered PDF uses the saved content and layout. Its file bytes are not promised to match an older stored file, because PDF metadata can differ.

## Product PI history

A saved product's page lists where that product has been quoted. The history is not shown while a new product is still unsaved, and editing the model on screen does not switch the history to another product.

By default the list includes:

- The latest issued version of each PI, when that version contains the product. The latest version is chosen first. If a later revision removes the product, the older version is not shown as the current offer.
- Each saved matching line on an open initial draft.
- Each saved matching line on an open revision draft, in addition to the latest issued version.

Closed working copies are not shown again as drafts. **Include older revisions** adds earlier issued versions that contain the product, with the version label and prices saved on that version. A duplicate PI is a separate document. Several lines for the same product on one version stay separate.

The quoted unit price is the saved line price before any invoice-wide discount, tax, or charge. A discount is marked **Discount on PI** and the saved discount type and value are in the row details. The history does not allocate that discount, convert currencies, or calculate a net price, revenue, or margin. An explicit zero stays zero. A missing draft price is **Not priced**.

Issued rows use that version's saved client, date, model, description, quantity, unit, price, and currency. Draft rows use the saved draft. **PI status** on an issued row is the invoice's current tracking status, not a status recorded for that revision. An issued PI whose tracking status is still draft is shown as **Issued**. Draft rows are labelled **Draft** even when the invoice has another tracking status.

New issued snapshots store the line id, product id, and position. Those lines match on product id, including after a model rename. Older snapshots are left unchanged. If a snapshot line has no product id, it matches only when the saved model is the same ignoring capitalisation and surrounding spaces. The row explains that model-only match. Renaming the catalogue model later can stop those older lines from matching. A line that already has a product id is not also attached to a different product because the model text looks similar.

The history uses the same PI visibility rules as the rest of the application. People only see PIs they are allowed to read, and inactive users see none. The result count and the client, currency, and status filters come from that same authorized set. Purchase prices are not part of the query.

## Access rules

Unauthenticated requests cannot read business tables. Anonymous grants are revoked. Any previously stored PDF remains private.

Every policy requires an active profile. A disabled user with an old access token gets no rows.

Active members can read clients, vendors, products, contacts, company presets, and default terms so they can prepare invoices. They can read other users' names and phones so a salesperson can be assigned. They cannot update `profiles`.

| Control | Effect |
| --- | --- |
| PI visibility: associated | Read a PI only if the user created it, generated a version of it, or is currently assigned as a salesperson. |
| PI visibility: all | Read every PI. |
| Create and edit drafts | Create, save, duplicate, delete unissued drafts, and open a revision. |
| Generate PIs | Issue a number and store the snapshot. It is not required to download an issued version. |
| Manage payment tracking and record receipts | Start tracking on an issued version and record allocated receipts. Existing members are not given this automatically. |
| Reverse receipts | Reverse a posted receipt. Recording a receipt does not include this. |
| Activate zero-value subscriptions | Set an explicit start date and reason when the obligation is zero. |
| Manage clients / vendors / products | Create and edit those records. Referenced companies and products are archived, not deleted. |
| View purchase prices | Read and, together with Manage products, write `product_costs`. The catalogue table has no purchase-price column. |
| Administrator | All of the above, plus Settings and the user function. Payment write flags are included. |
| Read a PI | Also read its payment plan, obligations, receipts, balances, and subscriptions. A direct link does not bypass PI visibility. |

Admins are not a separate bypass hidden in the browser. `private.has_flag` treats an active admin as having every flag, and the user function checks `is_admin` in the database.

Issued numbers, snapshots, totals, and "prepared by" are written only by database functions. The preparer is `auth.uid()` at generation time. Issuing a PI does not upload a file and does not wait for storage. The application no longer calls the PDF retry or confirmation functions, and signed-in users can no longer insert or delete objects in `pi-pdfs`. The bucket stays private. A select policy still limits any previously stored file to someone who can read that PI. There is no update policy. Download in the app does not use that file.

## Cloudflare

`wrangler.jsonc` targets Workers static assets with SPA fallback (`assets.not_found_handling` = `single-page-application`), a thin Worker entry, compatibility date 2026-10-18, and Workers logs and traces. This project is deployed to Cloudflare Workers. The production URL is not recorded in this repository.

```bash
npm run build
npx wrangler deploy
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the build environment before `npm run build`. They are not Worker secrets. Do not add the service-role key to Wrangler.

After the first deploy, add the production origin and `https://<your-host>/reset-password` to the Supabase redirect URLs.

### Branch previews before merging

Cloudflare's `wrangler preview` command requires a `previews` block. `npm run build:preview` builds the application, follows Vite's `.wrangler/deploy/config.json` redirect, and ensures the exact generated Wrangler configuration contains this block before preview deployment. It preserves any existing preview options and all other generated settings, and fails early if the build output or assets are missing. Keep the assets settings at the top level; the Vite build supplies the generated assets directory.

For a preview of an unmerged branch, configure that branch's build with:
- Build command: `npm run build:preview`.
- Preview/non-production deploy command: `npx wrangler preview`.
- Build variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Keep the production branch as `main` and its deploy command as `npx wrangler deploy`. A preview build must run the Vite build before Wrangler; a deploy-only run will not produce the generated configuration and assets.

The local equivalent is:

```bash
npm run build:preview
npx wrangler preview
```

A preview using the same Supabase URL shares the live database. Data edits are real; the preview isolates the frontend, not the external database. Add the preview origin and its `/reset-password` URL to Supabase's redirect allowlist if using invitation or password-reset links there.

## Backup and restore on Supabase Free

Free projects can be paused and do not include a self-serve point-in-time backup.

1. **Database.** In the dashboard, use **Database → Backups** if a backup is offered. Otherwise export with the Supabase CLI or `pg_dump` from the connection string in Project Settings → Database. Store the dump outside the project. Restore by creating a new project and loading the dump, then replaying any migrations that are newer than the dump.
2. **Issued documents.** The rows in `pi_versions`, especially `snapshot`, are what reproduce an issued PI. A PDF file is generated in the browser from that snapshot. Regenerating a PDF is not a database backup: if the snapshot row is lost, current catalogue and company records cannot rebuild it.
3. **Previously stored PDFs.** Files already in `pi-pdfs` are not required for download. Keep a copy until you deliberately run the cleanup in [docs/cleanup-pi-pdfs.md](docs/cleanup-pi-pdfs.md). That cleanup lists only generated PI PDFs, reports the count and total size, and deletes through the Storage API. It does not delete invoice rows, snapshots, logos, or other buckets.
4. **Restore check.** Confirm RLS is still enabled, the `ensure_rls` trigger still exists, and a non-admin cannot read `product_costs` or another user's PI.

Keep at least one recent database dump. A copy of `pi-pdfs` only preserves files created before on-demand PDFs.

## Limits of this version

No pipeline, inventory, accounting ledger, revenue recognition, tax invoice, supplier payment, payment gateway, bank reconciliation, receipt attachment, reminder job, renewal PI, vendor price confirmation workflow, email delivery of PIs, customer portal, currency conversion, or automatic tax rules. Payment tracking records receipts and outstanding balances against one agreed issued version. It does not label a receipt as revenue. A subscription starts when its own first-year obligation is fully paid, or by an explicit no-charge activation. Renewal invoicing is not implemented. Purchase-price permission is a separate table, not a column on `products`. Historical salesperson assignment is the current assignment list plus the people who created the draft or generated a version.

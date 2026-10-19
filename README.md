# Value CRM

Internal application for Value Technologies. Staff save clients, vendors, and products, prepare proforma invoices from that information, and download an English A4 PDF. It is not an ERP.

The hosted database is the Supabase project **Value CRM** (`idhqrvrpzlkpyyqlkozl`, eu-west-1) in the Value Technologies organization. Verifications and Value-Website are separate applications and were not modified.

PIs are the home page. A compact sidebar also opens Clients, Vendors, and Products. Settings is shown only to administrators, and is split into company and bank presets, default terms, and users. Everyday PI fields stay on one page: office and currency, client, dates, lead salesperson, items, payment and delivery terms, and totals. A separate shipping address, additional salespeople, discounts and charges, and the other commercial terms sit in labelled sections. A saved value stays visible as a summary when its section is closed. On the PI list, search, status, and New PI stay visible. Office, currency, salesperson, and date range are under Filters.

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

SQL lives in `supabase/migrations` and is the reproducible schema. It has already been applied to the Value CRM project. Do not run it again there.

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
```

The first migration installs `public.rls_auto_enable()` and the `ensure_rls` event trigger. That is the same automatic RLS trigger used on the other Value Technologies projects: every new table in `public` gets row level security. The trigger does not create policies. This repo creates those policies explicitly and also enables RLS in the table statements.

`20261019080451_on_demand_pi_pdfs.sql` is included in the list above and has been applied to Value CRM. It does not rewrite issued snapshots or existing PDF metadata.

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

Default commercial terms are copied onto each new draft and stay editable on that PI.

## Proforma invoices

Each item on a draft is a catalogue product. Add it under the last line, search by model, and select it, or create a new catalogue product without leaving the PI if you manage products. Model names are unique across the catalogue, including archived products; comparison ignores capitalisation and surrounding spaces, and the saved spelling is what the PI shows. The line copies the product's vendor, description, unit, and the default selling price for the PI currency. A missing price stays blank and an explicit zero stays zero. There is no currency conversion. Description, unit, quantity, and selling price can then be edited for that PI only. Changing the model selects or creates a different product; it does not rename the previous one. Vendor cannot be changed independently of the product. Brand is not required and is not added to the description.

Drag the row handle, or open Reorder and choose Move up or Move down, to set the order. That order is kept on the draft and used by preview, the issued PDF, duplicates, and later revisions. Older issued versions keep the order they were generated with.

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

The customer PDF contains the company, client, bill-to, ship-to, lead salesperson name and phone, preparer name, items, totals, terms, and bank details. Additional salespeople, purchase prices, and vendors stay internal. Draft preview and issued download use the same pdfmake renderer. The renderer dispatches on the snapshot's `layout_version` (`egypt-v1` or `uae-v1`). An unsupported layout version is reported and is not drawn with a different layout. The issued PDF is rendered only from the snapshot: client and contact, line order, quantities, units, prices, saved totals, terms, company and bank details, salesperson and preparer, dates, and the saved logo. Current client, product, user, logo, or bank records are not read to fill an old document. If a snapshot is missing data the renderer needs, the download stops with that gap instead of substituting current records. Replacing the logo or a catalogue row does not change an issued snapshot.

`pi_versions.pdf_status` and `pdf_path` remain as legacy metadata. New versions are stored as `issued` with no file path. Older rows may still say `pending` or `ready`; the screen does not treat that as a failed download. Previously stored files in the private `pi-pdfs` bucket are left in place. Removing them is a separate step, described in [docs/cleanup-pi-pdfs.md](docs/cleanup-pi-pdfs.md), and it has not been run.

A newly rendered PDF uses the saved content and layout. Its file bytes are not promised to match an older stored file, because PDF metadata can differ.

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
| Manage clients / vendors / products | Create and edit those records. Referenced companies and products are archived, not deleted. |
| View purchase prices | Read and, together with Manage products, write `product_costs`. The catalogue table has no purchase-price column. |
| Administrator | All of the above, plus Settings and the user function. |

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

Cloudflare's `wrangler preview` command requires the top-level `"previews": {}` block included in this repository. Keep the assets settings at the top level; the Vite build supplies the generated assets directory.

For a preview of an unmerged branch, configure that branch's build with:
- Build command: `npm run build`.
- Preview/non-production deploy command: `npx wrangler preview`.
- Build variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

Keep the production branch as `main` and its deploy command as `npx wrangler deploy`. A preview build must run the Vite build before Wrangler; a deploy-only run will not produce the generated configuration and assets.

The local equivalent is:

```bash
npm run build
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

No pipeline, inventory, accounting, payments, email delivery of PIs, customer portal, currency conversion, or automatic tax rules. Purchase-price permission is a separate table, not a column on `products`. Historical salesperson assignment is the current assignment list plus the people who created the draft or generated a version.

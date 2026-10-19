# Cleanup of previously stored PI PDFs

This procedure is prepared and has not been run. Do not delete files until someone explicitly asks for this cleanup.

New proforma invoices are rendered in the browser from `pi_versions.snapshot`. The application no longer uploads PDFs. Objects already in the private `pi-pdfs` bucket are unchanged by that switch.

The cleanup removes only generated PI PDF objects. It does not delete invoice records, issued versions, snapshots, logos, or objects in any other bucket.

## What it deletes

A generated PI PDF is an object whose name is a UUID followed by `.pdf`, in the `pi-pdfs` bucket only. That is the name the old upload flow used: `{version-id}.pdf`.

Any other object is reported and blocks deletion. Nothing is deleted while such an object is present.

## Report first

From the repository root, with the service-role key available only in the environment:

```bash
SUPABASE_URL=https://idhqrvrpzlkpyyqlkozl.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node --experimental-strip-types scripts/pi-pdf-cleanup.ts
```

This lists `pi-pdfs` through the Storage API and prints:

- the number of generated PI PDFs
- their total size in bytes
- any skipped object names

It does not delete. Do not use the publishable key; it cannot list this private bucket. Do not delete rows from `storage.objects` with SQL.

## Delete only when explicitly requested

Run the same command with both of these, after reading the report:

- the argument `--delete`
- the environment variable `CONFIRM_PI_PDF_CLEANUP=delete-pi-pdfs`

```bash
SUPABASE_URL=https://idhqrvrpzlkpyyqlkozl.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
CONFIRM_PI_PDF_CLEANUP=delete-pi-pdfs \
node --experimental-strip-types scripts/pi-pdf-cleanup.ts --delete
```

The script prints the count and total size again, then calls `storage.from('pi-pdfs').remove(...)` in batches. If the bucket contains anything that is not a generated PI PDF, it stops before removing any object.

The service-role key bypasses Storage policies. Signed-in users no longer have insert or delete policies on this bucket.

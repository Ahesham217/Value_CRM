# UI guidelines

Value CRM is an internal business workspace. Keep it calm, readable, and the same from screen to screen. These rules cover presentation. They do not change permissions, money, numbering, or the customer PDF.

The tokens live in `src/index.css`. Shared controls live in `src/components/ui.tsx`. Use those instead of new colours or one-off control sizes.

## Tokens

| Use | Token | Value |
| --- | --- | --- |
| Page background | `canvas` | `#F5F7FA` |
| Surface | `surface` / white | `#FFFFFF` |
| Main text | `ink` | `#172B4D` |
| Secondary text | `secondary` | `#526175` |
| Muted text | `muted` | `#66758A` |
| Border | `line` | `#E4E9F0` |
| Primary navy | `primary` | `#193B65` |
| Primary hover | `primary-hover` | `#123050` |
| Selected / navigation | `selected` | `#EAF1F8` |
| Table header | `table` | `#F7F9FC` |
| Success | `success` / `success-soft` | `#16624F` / `#EAF6F0` |
| Warning | `warning` / `warning-soft` | `#925400` / `#FFF5E5` |
| Danger | `danger` / `danger-soft` | `#B42318` / `#FEF0EE` |

`navy-950`, `navy-900`, `navy-800`, and `navy-100` are aliases of the workspace navy. Do not use them for Paid, Accepted, Overdue, or Cancelled. Those statuses use success, warning, and danger, with a text label as well as colour.

Type is Inter when the computer already has it, then Segoe UI, Helvetica Neue, Arial, sans-serif. Do not add a remote font. Page titles are 26px at weight 600. Section headings are 17–18px at weight 600. Body and inputs are 14px. Table text is 13–14px. Labels are 13px at weight 500. Metadata is at least 12px. Money uses tabular numerals.

Spacing follows 4px and 8px. Desktop page padding is 24–28px. Controls and standard buttons are 40px tall. Radius is 8px. Ordinary surfaces have a border and no shadow. Only menus, dropdowns, and dialogs use the overlay shadow.

## Tables

Use `tableWrapClass`, `theadClass`, `thClass`, and `tdClass`.

- Light header, thin horizontal rules, no heavy vertical grid.
- Text is left-aligned. Quantities and money are right-aligned.
- Keep the currency visible on the amount.
- Let descriptions wrap. Do not shrink important text below 13px to fit more columns.
- A clickable row still contains a real link, so keyboard and modified-click navigation work.
- If a table is wider than the page, the scroll stays on the table.
- Pagination shows the visible range and stays under the table.

## Forms and actions

Labels sit above controls. A search field in a toolbar may use a visually hidden label. Read-only information is text, not a disabled input. Put the error next to the field. Keep the entered value after a failed save.

One primary action per working area uses the solid navy button. Secondary actions are outlines. Quiet actions are text. Destructive actions are labelled and kept apart from the primary action. An icon-only control needs an accessible name.

Form pages should not stretch short fields across a very wide screen. `formSheetClass` caps a document or record form. Lists and reports use the content width.

## Disclosures

A disclosure is presentation only.

- Opening it does not save.
- Closing it does not discard what the person typed.
- A closed section still shows a short summary when it has a saved value.
- `aria-expanded` is set on the control.
- Do not hide an allocation error, a date-review warning, or an incomplete payment schedule behind a closed section.
- The payment schedule fields stay in one editor slot while that editor is open. A valid or invalid result must not replace the inputs, move focus, or change row identity. Closing is available only when the schedule is not blocking, and it does not save or discard the rows.
- The draft is saved only by Save draft or Generate PI. There is no autosave.

## Shell

Workspace and Directory stay open in the sidebar. Settings and Sign out stay at the bottom. Settings remains administrator-only. Proforma invoices remain the page after sign-in. Detail and editor breadcrumbs link back to the parent list.

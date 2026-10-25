import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CatalogueProduct } from "../lib/catalogue";
import { formatMoney } from "../lib/format";
import {
  applyCommitment,
  blankLine,
  choiceUnitPrice,
  clearCommitment,
  isBlankPlaceholder,
  lineWarning,
  moveEditorLine,
  reorderEditorLines,
  revertModelInput,
  selectProduct,
  selectionNotice,
  type EditorLine,
} from "../lib/pi-lines";
import { catalogueDriftMessage, commitmentHeading, negotiationNote } from "../lib/subscription";
import { numericInputValue } from "../lib/numeric-input";
import type { CurrencyCode, ProductCommitmentOption } from "../lib/types";
import { descriptionSummary } from "../lib/workspace-view";
import { CreateCatalogueProduct } from "./CreateCatalogueProduct";
import { ModelCombobox } from "./ModelCombobox";
import { Button, Menu, cellControlClass, controlClass } from "./ui";

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="5" cy="3.5" r="1.15" fill="currentColor" />
      <circle cx="11" cy="3.5" r="1.15" fill="currentColor" />
      <circle cx="5" cy="8" r="1.15" fill="currentColor" />
      <circle cx="11" cy="8" r="1.15" fill="currentColor" />
      <circle cx="5" cy="12.5" r="1.15" fill="currentColor" />
      <circle cx="11" cy="12.5" r="1.15" fill="currentColor" />
    </svg>
  );
}

const rowGrid =
  "grid grid-cols-[1.75rem_minmax(10.5rem,1.15fr)_minmax(14rem,2.4fr)_4.5rem_5.5rem_7.25rem_7.75rem_2.25rem] items-center gap-x-3";

function SortableItem({
  line,
  index,
  count,
  currency,
  commitments,
  canEdit,
  canManageProducts,
  autoFocus,
  lineTotal,
  onChange,
  onMove,
  onRemove,
  onAutoFocused,
  onNotice,
}: {
  line: EditorLine;
  index: number;
  count: number;
  currency: CurrencyCode | null;
  commitments: ProductCommitmentOption[];
  canEdit: boolean;
  canManageProducts: boolean;
  autoFocus: boolean;
  lineTotal: string;
  onChange: (line: EditorLine) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onAutoFocused: () => void;
  onNotice: (message: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.key,
    disabled: !canEdit,
  });
  const [creating, setCreating] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const warning = lineWarning(line, canManageProducts);
  const vendorNeedsAttention = Boolean(line.product && (line.product.vendorArchived || !line.product.vendorName.trim()));
  const summary = descriptionSummary(line.description);
  const itemNumber = index + 1;

  useEffect(() => {
    if (editingDescription) descriptionRef.current?.focus();
  }, [editingDescription]);

  function applyProduct(product: CatalogueProduct, prefix: string | null) {
    const subscriptionProduct = product.billing_type === "subscription";
    const unitPrice = subscriptionProduct ? null : choiceUnitPrice(product, currency);
    onChange(selectProduct(line, {
      id: product.id,
      model_code: product.model_code,
      vendor_id: product.vendor_id,
      vendor_name: product.vendor_name,
      vendor_archived: product.vendor_archived,
      description: product.description,
      unit: product.unit,
      unit_price: unitPrice,
      billing_type: product.billing_type,
    }));
    const priceNote = subscriptionProduct
      ? `Selected ${product.model_code}. Choose a commitment. The Year 1 price comes from that commitment and is not converted from another currency.`
      : selectionNotice(product.model_code, currency, unitPrice);
    const message = [prefix, priceNote].filter(Boolean).join(" ");
    if (message) onNotice(message);
  }

  const productOptions = commitments.filter((option) => option.product_id === line.product?.id);
  const selectableOptions = productOptions.filter((option) => (
    option.id === line.subscription?.optionId
    || (option.currency === currency && !option.archived_at)
  ));
  const selectedOption = productOptions.find((option) => option.id === line.subscription?.optionId) ?? null;
  const negotiated = line.subscription
    ? negotiationNote(
      currency,
      line.unitPrice,
      line.subscription.catalogueFirstYearUnitPrice,
      line.subscription.laterYearBaseUnitPrice,
      line.subscription.catalogueLaterYearBaseUnitPrice,
    )
    : null;
  const drift = line.subscription
    ? catalogueDriftMessage({
      savedYears: line.subscription.commitmentYears,
      savedRule: line.subscription.laterYearRule,
      savedCatalogueYearOne: line.subscription.catalogueFirstYearUnitPrice,
      savedCatalogueLaterBase: line.subscription.catalogueLaterYearBaseUnitPrice,
      savedCurrency: line.subscription.currency,
      option: selectedOption,
    })
    : null;

  return (
    <>
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="row"
      className={`${rowGrid} min-h-14 border-b border-line px-3 py-2 ${isDragging ? "relative z-10 bg-white shadow-sm" : ""} ${warning ? "bg-warning-soft" : ""}`}
    >
      <div role="cell" className="pt-1">
        {canEdit ? (
          <button
            type="button"
            className="inline-flex h-8 w-7 cursor-grab items-center justify-center rounded-md text-muted touch-none hover:bg-canvas"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder item ${itemNumber}`}
          >
            <GripIcon />
          </button>
        ) : null}
      </div>
      <div role="cell" className="min-w-0">
        {canEdit ? (
          <ModelCombobox
            value={line.modelInput}
            committedModel={line.product?.modelCode ?? null}
            disabled={false}
            canCreate={canManageProducts}
            compact
            plain
            label={`Model for item ${itemNumber}`}
            autoFocus={autoFocus}
            onAutoFocused={onAutoFocused}
            onChange={(modelInput) => onChange({ ...line, modelInput })}
            onSelect={(product, notice) => applyProduct(product, notice ?? null)}
            onCreate={setCreating}
            onRevert={() => onChange(revertModelInput(line))}
          />
        ) : (
          <input className={`${cellControlClass} font-medium`} readOnly aria-label={`Model for item ${itemNumber}`} value={line.modelInput} />
        )}
        <p className="mt-0.5 truncate px-1.5 text-[12px] text-muted">
          {line.product?.vendorName ? `Vendor · ${line.product.vendorName}` : (line.modelInput.trim() ? "Vendor required" : "")}
        </p>
      </div>
      <div role="cell" className="min-w-0">
        {editingDescription ? (
          <div>
            <textarea
              ref={descriptionRef}
              rows={4}
              className={`${controlClass} h-auto min-h-16 py-2`}
              aria-label={`Description for item ${itemNumber}`}
              disabled={!canEdit}
              value={line.description}
              onChange={(event) => onChange({ ...line, description: event.target.value })}
            />
            <button type="button" className="mt-1 text-xs text-navy-800 underline" onClick={() => setEditingDescription(false)}>
              Hide description
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="line-clamp-2 min-h-9 w-full rounded-md px-1.5 py-1.5 text-left text-sm text-ink hover:bg-canvas"
            aria-expanded={false}
            onClick={() => setEditingDescription(true)}
          >
            {summary || <span className="text-muted">{canEdit ? "Add description" : "No description"}</span>}
          </button>
        )}
      </div>
      <div role="cell">
        <input
          className={`${cellControlClass} text-right`}
          inputMode="decimal"
          aria-label={`Quantity for item ${itemNumber}`}
          disabled={!canEdit}
          value={line.quantity}
          onChange={(event) => onChange({ ...line, quantity: event.target.value })}
        />
      </div>
      <div role="cell">
        <input
          className={cellControlClass}
          aria-label={`Unit for item ${itemNumber}`}
          disabled={!canEdit}
          value={line.unit}
          onChange={(event) => onChange({ ...line, unit: event.target.value })}
        />
      </div>
      <div role="cell">
        <input
          className={`${cellControlClass} text-right`}
          inputMode="decimal"
          aria-label={line.product?.billingType === "subscription" ? `Year 1 unit price for item ${itemNumber}` : `Unit price for item ${itemNumber}`}
          disabled={!canEdit}
          value={line.unitPrice}
          onChange={(event) => onChange({ ...line, unitPrice: event.target.value })}
        />
      </div>
      <div role="cell" className="pr-1 text-right text-sm font-medium tabular-nums text-ink">
        {lineTotal || "—"}
      </div>
      <div role="cell" className="flex justify-end">
        {canEdit ? (
          <Menu
            appearance="quiet"
            label={`Actions for item ${itemNumber}`}
            items={[
              { label: "Move up", onSelect: () => onMove(-1), disabled: index === 0 },
              { label: "Move down", onSelect: () => onMove(1), disabled: index === count - 1 },
              { label: "Remove", onSelect: onRemove, tone: "danger" },
            ]}
          />
        ) : null}
      </div>
      {line.product?.billingType === "subscription" ? (
        <div className="col-span-full mt-2 rounded-md border border-line bg-canvas px-3 py-3">
          <div className="grid gap-3 md:grid-cols-[minmax(16rem,1.4fr)_minmax(10rem,0.8fr)]">
            <label className="block text-sm">
              <span className="mb-1 block text-[13px] font-medium text-muted">Commitment</span>
              <select
                className={controlClass}
                disabled={!canEdit || !currency}
                value={line.subscription?.optionId ?? ""}
                onChange={(event) => {
                  const optionId = event.target.value;
                  if (!optionId) {
                    onChange(clearCommitment(line));
                    return;
                  }
                  const option = selectableOptions.find((item) => item.id === optionId);
                  if (!option) return;
                  onChange(applyCommitment(line, option));
                }}
              >
                <option value="">{currency ? "Select a commitment" : "Choose an office and currency first"}</option>
                {selectableOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {commitmentHeading(option.commitment_years)}
                    {option.archived_at ? " (archived)" : ""}
                    {` · Year 1 ${formatMoney(numericInputValue(option.first_year_unit_price), option.currency)}`}
                  </option>
                ))}
              </select>
            </label>
            {line.subscription && line.subscription.commitmentYears > 1 ? (
              <label className="block text-sm">
                <span className="mb-1 block text-[13px] font-medium text-muted">Later-year base</span>
                <input
                  className={`${controlClass} text-right`}
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={line.subscription.laterYearBaseUnitPrice ?? ""}
                  aria-label={`Later-year base for item ${itemNumber}`}
                  onChange={(event) => onChange({
                    ...line,
                    subscription: line.subscription
                      ? { ...line.subscription, laterYearBaseUnitPrice: event.target.value }
                      : null,
                  })}
                />
              </label>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted">
            {line.subscription
              ? `${commitmentHeading(line.subscription.commitmentYears)}. Quantity is the number of units. The amount column is the Year 1 charge only.`
              : "Select a commitment for this currency. A missing currency price is not filled from another currency."}
          </p>
          {line.subscription && currency && line.subscription.currency !== currency ? (
            <p className="mt-1 text-xs text-amber-950">
              This commitment is priced in {line.subscription.currency}. This PI is {currency}. Prices are not converted. Choose a {currency} commitment. The saved terms were not replaced.
            </p>
          ) : null}
          {negotiated ? <p className="mt-1 text-xs text-secondary">{negotiated}</p> : null}
          {drift ? <p className="mt-1 text-xs text-secondary">{drift}</p> : null}
        </div>
      ) : line.subscription ? (
        <div className="col-span-full mt-2 text-xs text-amber-950">
          This one-time line still has a subscription commitment.
          {canEdit ? (
            <button type="button" className="ml-2 underline" onClick={() => onChange(clearCommitment(line))}>Remove commitment</button>
          ) : null}
        </div>
      ) : null}
      {warning ? (
        <p className="col-span-full text-xs text-amber-950">
          {warning}
          {canManageProducts && vendorNeedsAttention && line.product ? (
            <>
              {" "}
              <Link className="underline" to={`/products/${line.product.id}`}>Open product</Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
    {creating !== null ? (
      <CreateCatalogueProduct
        initialModel={creating}
        currency={currency}
        onCancel={() => setCreating(null)}
        onSelected={(product, notice) => {
          setCreating(null);
          applyProduct(product, notice);
        }}
      />
    ) : null}
    </>
  );
}

export function PiItemSection({
  lines,
  currency,
  commitments,
  canEdit,
  canManageProducts,
  totals,
  onChange,
  onNotice,
}: {
  lines: EditorLine[];
  currency: CurrencyCode | null;
  commitments: ProductCommitmentOption[];
  canEdit: boolean;
  canManageProducts: boolean;
  totals: (string | null)[];
  onChange: (lines: EditorLine[]) => void;
  onNotice: (message: string) => void;
}) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function addItem() {
    const line = blankLine();
    setFocusKey(line.key);
    onChange([...lines, line]);
  }

  function removeItem(key: string) {
    onChange(lines.filter((item) => item.key !== key));
    requestAnimationFrame(() => addRef.current?.focus());
  }

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    onChange(reorderEditorLines(lines, String(event.active.id), String(overId)));
  }

  return (
    <section aria-label="Items">
      <div>
        {lines.length === 0 ? <p className="py-6 text-sm text-muted">No items yet.</p> : (
          <div className="overflow-x-auto">
            <div className="min-w-[52rem]" role="table" aria-label="PI items">
              <div role="row" className={`${rowGrid} border-b border-line px-3 py-2 text-[13px] font-medium text-muted`}>
                <div role="columnheader"><span className="sr-only">Reorder</span></div>
                <div role="columnheader">Item</div>
                <div role="columnheader">Description</div>
                <div role="columnheader" className="text-right">Qty</div>
                <div role="columnheader">Unit</div>
                <div role="columnheader" className="text-right">Unit price{currency ? ` (${currency})` : ""}</div>
                <div role="columnheader" className="text-right">Amount</div>
                <div role="columnheader"><span className="sr-only">Actions</span></div>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={lines.map((line) => line.key)} strategy={verticalListSortingStrategy}>
                  {lines.map((line, index) => (
                    <SortableItem
                      key={line.key}
                      line={line}
                      index={index}
                      count={lines.length}
                      currency={currency}
                      commitments={commitments}
                      canEdit={canEdit}
                      canManageProducts={canManageProducts}
                      autoFocus={focusKey === line.key}
                      lineTotal={isBlankPlaceholder(line) ? "" : formatMoney(totals[index], currency)}
                      onChange={(next) => onChange(lines.map((item) => (item.key === next.key ? next : item)))}
                      onMove={(direction) => onChange(moveEditorLine(lines, index, direction))}
                      onRemove={() => removeItem(line.key)}
                      onAutoFocused={() => setFocusKey((current) => (current === line.key ? null : current))}
                      onNotice={onNotice}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </div>
        )}
        {canEdit ? (
          <Button ref={addRef} type="button" variant="quiet" className="mt-3 px-0" onClick={addItem}>
            + Add an item
          </Button>
        ) : null}
      </div>
    </section>
  );
}

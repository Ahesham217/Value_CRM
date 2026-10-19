import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CatalogueProduct } from "../lib/catalogue";
import { formatMoney } from "../lib/format";
import {
  blankLine,
  choiceUnitPrice,
  isBlankPlaceholder,
  lineWarning,
  moveEditorLine,
  reorderEditorLines,
  revertModelInput,
  selectProduct,
  selectionNotice,
  type EditorLine,
} from "../lib/pi-lines";
import type { CurrencyCode } from "../lib/types";
import { descriptionSummary } from "../lib/workspace-view";
import { CreateCatalogueProduct } from "./CreateCatalogueProduct";
import { ModelCombobox } from "./ModelCombobox";
import { Button, Menu, controlClass } from "./ui";

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
  "grid grid-cols-[2rem_minmax(10rem,1.2fr)_minmax(12rem,1.8fr)_4.75rem_4.75rem_6.25rem_6.5rem_auto] items-start gap-x-2";

function SortableItem({
  line,
  index,
  count,
  currency,
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
    const unitPrice = choiceUnitPrice(product, currency);
    onChange(selectProduct(line, {
      id: product.id,
      model_code: product.model_code,
      vendor_id: product.vendor_id,
      vendor_name: product.vendor_name,
      vendor_archived: product.vendor_archived,
      description: product.description,
      unit: product.unit,
      unit_price: unitPrice,
    }));
    const priceNote = selectionNotice(product.model_code, currency, unitPrice);
    const message = [prefix, priceNote].filter(Boolean).join(" ");
    if (message) onNotice(message);
  }

  return (
    <>
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      role="row"
      className={`${rowGrid} border-t border-slate-100 px-2 py-1.5 ${isDragging ? "relative z-10 bg-white shadow-md" : ""} ${warning ? "bg-amber-50" : ""}`}
    >
      <div role="cell" className="pt-1">
        {canEdit ? (
          <button
            type="button"
            className="inline-flex h-9 w-8 cursor-grab items-center justify-center rounded-md text-slate-500 touch-none hover:bg-slate-100"
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
            label={`Model for item ${itemNumber}`}
            autoFocus={autoFocus}
            onAutoFocused={onAutoFocused}
            onChange={(modelInput) => onChange({ ...line, modelInput })}
            onSelect={(product, notice) => applyProduct(product, notice ?? null)}
            onCreate={setCreating}
            onRevert={() => onChange(revertModelInput(line))}
          />
        ) : (
          <input className={controlClass} readOnly aria-label={`Model for item ${itemNumber}`} value={line.modelInput} />
        )}
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {line.product?.vendorName
            ? `Vendor: ${line.product.vendorName}`
            : "Vendor comes from the product"}
        </p>
      </div>
      <div role="cell" className="min-w-0">
        {editingDescription ? (
          <div>
            <textarea
              ref={descriptionRef}
              rows={4}
              className={`${controlClass} h-auto min-h-16 py-1.5`}
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
            className="line-clamp-2 min-h-9 w-full rounded-md px-1 py-1.5 text-left text-sm hover:bg-slate-50"
            aria-expanded={false}
            onClick={() => setEditingDescription(true)}
          >
            {summary || <span className="text-slate-500">{canEdit ? "Add description" : "No description"}</span>}
          </button>
        )}
      </div>
      <div role="cell">
        <input
          className={`${controlClass} text-right tabular-nums`}
          inputMode="decimal"
          aria-label={`Quantity for item ${itemNumber}`}
          disabled={!canEdit}
          value={line.quantity}
          onChange={(event) => onChange({ ...line, quantity: event.target.value })}
        />
      </div>
      <div role="cell">
        <input
          className={controlClass}
          aria-label={`Unit for item ${itemNumber}`}
          disabled={!canEdit}
          value={line.unit}
          onChange={(event) => onChange({ ...line, unit: event.target.value })}
        />
      </div>
      <div role="cell">
        <input
          className={`${controlClass} text-right tabular-nums`}
          inputMode="decimal"
          aria-label={`Unit price for item ${itemNumber}`}
          disabled={!canEdit}
          value={line.unitPrice}
          onChange={(event) => onChange({ ...line, unitPrice: event.target.value })}
        />
      </div>
      <div role="cell" className="pt-2 text-right text-sm tabular-nums text-slate-800">
        {lineTotal || "—"}
      </div>
      <div role="cell" className="flex items-center justify-end gap-1">
        {canEdit ? (
          <>
            {count > 1 ? (
              <Menu
                label="Reorder"
                items={[
                  { label: "Move up", onSelect: () => onMove(-1), disabled: index === 0 },
                  { label: "Move down", onSelect: () => onMove(1), disabled: index === count - 1 },
                ]}
              />
            ) : null}
            <Button type="button" variant="ghost" className="px-2" aria-label={`Remove item ${itemNumber}`} onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : null}
      </div>
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
  canEdit,
  canManageProducts,
  totals,
  onChange,
  onNotice,
}: {
  lines: EditorLine[];
  currency: CurrencyCode | null;
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
    <section className="rounded-md border border-slate-200 bg-white" aria-label="Items">
      <div className="border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-semibold text-navy-950">Items</h2>
      </div>
      <div className="p-2">
        {lines.length === 0 ? <p className="px-2 py-3 text-sm text-slate-600">No items yet.</p> : (
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <div className="min-w-[52rem]" role="table" aria-label="PI items">
              <div role="row" className={`${rowGrid} bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-500`}>
                <div role="columnheader"><span className="sr-only">Reorder</span></div>
                <div role="columnheader">Model</div>
                <div role="columnheader">Description</div>
                <div role="columnheader" className="text-right">Qty</div>
                <div role="columnheader">Unit</div>
                <div role="columnheader" className="text-right">Unit price{currency ? ` (${currency})` : ""}</div>
                <div role="columnheader" className="text-right">Total</div>
                <div role="columnheader" className="text-right"><span className="sr-only">Actions</span></div>
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
          <div className="mt-2">
            <Button ref={addRef} type="button" onClick={addItem}>Add an item</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

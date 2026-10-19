import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
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
import { CreateCatalogueProduct } from "./CreateCatalogueProduct";
import { ModelCombobox } from "./ModelCombobox";
import { Button, Field, TextArea, controlClass } from "./ui";

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
  const warning = lineWarning(line, canManageProducts);
  const vendorNeedsAttention = Boolean(line.product && (line.product.vendorArchived || !line.product.vendorName.trim()));

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
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-md border bg-white p-3 ${isDragging ? "z-10 border-slate-300 shadow-md" : "border-slate-200"} ${warning ? "border-amber-300" : ""}`}
    >
      <div className="flex gap-2">
        {canEdit ? (
          <button
            type="button"
            className="mt-6 inline-flex h-9 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-500 touch-none hover:bg-slate-100"
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder item ${index + 1}`}
          >
            <GripIcon />
          </button>
        ) : null}
        <div className="grid flex-1 gap-2 md:grid-cols-6">
          <div className="md:col-span-2">
            {canEdit ? (
              <ModelCombobox
                value={line.modelInput}
                committedModel={line.product?.modelCode ?? null}
                disabled={false}
                canCreate={canManageProducts}
                autoFocus={autoFocus}
                onAutoFocused={onAutoFocused}
                onChange={(modelInput) => onChange({ ...line, modelInput })}
                onSelect={(product, notice) => applyProduct(product, notice ?? null)}
                onCreate={setCreating}
                onRevert={() => onChange(revertModelInput(line))}
              />
            ) : (
              <Field label="Model">
                <input className={controlClass} readOnly value={line.modelInput} />
              </Field>
            )}
          </div>
          <Field label="Vendor">
            <input className={controlClass} readOnly value={line.product?.vendorName ?? ""} placeholder="From the product" />
          </Field>
          <Field label="Unit">
            <input className={controlClass} disabled={!canEdit} value={line.unit} onChange={(event) => onChange({ ...line, unit: event.target.value })} />
          </Field>
          <Field label="Quantity">
            <input className={controlClass} inputMode="decimal" disabled={!canEdit} value={line.quantity} onChange={(event) => onChange({ ...line, quantity: event.target.value })} />
          </Field>
          <Field label={`Unit price${currency ? ` (${currency})` : ""}`}>
            <input className={controlClass} inputMode="decimal" disabled={!canEdit} value={line.unitPrice} onChange={(event) => onChange({ ...line, unitPrice: event.target.value })} />
          </Field>
          <Field label="Line total">
            <input className={controlClass} readOnly value={lineTotal} />
          </Field>
        </div>
      </div>
      <div className="mt-2">
        <Field label="Description">
          <TextArea disabled={!canEdit} value={line.description} onChange={(event) => onChange({ ...line, description: event.target.value })} />
        </Field>
      </div>
      {warning ? (
        <p className="mt-2 text-sm text-amber-950">
          {warning}
          {canManageProducts && vendorNeedsAttention && line.product ? (
            <> <Link className="underline" to={`/products/${line.product.id}`}>Open product</Link></>
          ) : null}
        </p>
      ) : null}
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" disabled={index === 0} aria-label={`Move item ${index + 1} up`} onClick={() => onMove(-1)}>Move up</Button>
          <Button type="button" disabled={index === count - 1} aria-label={`Move item ${index + 1} down`} onClick={() => onMove(1)}>Move down</Button>
          <Button type="button" variant="ghost" onClick={onRemove}>Remove</Button>
        </div>
      ) : null}
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
    </div>
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function addItem() {
    const line = blankLine();
    setFocusKey(line.key);
    onChange([...lines, line]);
  }

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    onChange(reorderEditorLines(lines, String(event.active.id), String(overId)));
  }

  const addButton = canEdit ? <Button type="button" onClick={addItem}>Add an item</Button> : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Items</h2>
      <p className="mb-3 mt-1 text-sm text-slate-600">
        Add an item under the list, then search by model. Vendor comes from the product. Description, unit, quantity, and selling price belong to this PI and do not change the catalogue.
      </p>
      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center">
          <p className="text-sm text-slate-600">No items yet. Add one and choose a model.</p>
          {addButton ? <div className="mt-3">{addButton}</div> : null}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={lines.map((line) => line.key)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
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
                  onRemove={() => onChange(lines.filter((item) => item.key !== line.key))}
                  onAutoFocused={() => setFocusKey((current) => (current === line.key ? null : current))}
                  onNotice={onNotice}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {lines.length > 0 && canEdit ? <div className="mt-3">{addButton}</div> : null}
      {canEdit && lines.length > 1 ? <p className="mt-2 text-xs text-slate-500">Drag a handle to reorder, or use Move up and Move down.</p> : null}
    </section>
  );
}

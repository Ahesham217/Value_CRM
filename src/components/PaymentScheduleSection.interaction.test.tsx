/**
 * @vitest-environment happy-dom
 */
import { act, useRef, useState, type ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { fullAdvanceTemplate, type PaymentSchedule } from "../lib/payment-schedule";
import { PaymentScheduleSection } from "./PaymentScheduleSection";

type Probe = {
  schedule: PaymentSchedule;
  edits: number;
  persisted: number;
};

function percentageInput(container: ParentNode): HTMLInputElement {
  const match = [...container.querySelectorAll("label")].find((label) => label.querySelector("span")?.textContent === "Percentage");
  const input = match?.querySelector("input");
  if (!(input instanceof HTMLInputElement)) throw new Error("Percentage input missing");
  return input;
}

function editButton(container: ParentNode): HTMLButtonElement | null {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Edit payment schedule"));
  return button instanceof HTMLButtonElement ? button : null;
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typePercentage(input: HTMLInputElement, value: string, caret: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Input value setter missing");
  act(() => {
    setter.call(input, value);
    input.setSelectionRange(caret, caret);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function EditorHarness({
  initial,
  probe,
  grandTotal = "100.00",
  percentageOf = "grand_total",
  percentageBase = null,
  allocationNote = null,
  allocationIssues = null,
}: {
  initial: PaymentSchedule;
  probe: Probe;
  grandTotal?: string;
  percentageOf?: "grand_total" | "one_time";
  percentageBase?: string | null;
  allocationNote?: string | null;
  allocationIssues?: { rowId: string | null; message: string }[] | null;
}) {
  const [schedule, setSchedule] = useState(initial);
  const probeRef = useRef(probe);
  probeRef.current = probe;
  probe.schedule = schedule;
  return (
    <>
      <PaymentScheduleSection
        mode="structured"
        legacyText=""
        schedule={schedule}
        currency="USD"
        grandTotal={grandTotal}
        percentageOf={percentageOf}
        percentageBase={percentageBase}
        allocationNote={allocationNote}
        allocationIssues={allocationIssues}
        canEdit
        showLegacyCancel={false}
        onLegacyText={() => undefined}
        onReplaceLegacy={() => undefined}
        onCancelReplacement={() => undefined}
        onSchedule={(next) => {
          probeRef.current.edits += 1;
          setSchedule(next);
        }}
      />
      <button type="button" onClick={() => { probeRef.current.persisted += 1; }}>Save draft</button>
    </>
  );
}

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const mounted: { unmount: () => void }[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

function renderEditor(props: Omit<Parameters<typeof EditorHarness>[0], "probe"> & { probe?: Probe }) {
  const probe: Probe = props.probe ?? { schedule: props.initial, edits: 0, persisted: 0 };
  const view = mount(<EditorHarness {...props} probe={probe} />);
  mounted.push(view);
  return { ...view, probe };
}

describe("payment schedule editor interaction", () => {
  it("keeps the same percentage input while a valid schedule becomes invalid and is typed further", () => {
    const initial = fullAdvanceTemplate();
    const rowId = initial.rows[0]?.id;
    const { container, probe } = renderEditor({ initial, grandTotal: "100.00" });
    const open = editButton(container);
    if (!open) throw new Error("Edit payment schedule missing");
    click(open);
    const input = percentageInput(container);
    input.focus();
    input.setSelectionRange(0, 3);

    typePercentage(input, "10", 2);

    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("10");
    expect(input.selectionStart).toBe(2);
    expect(input.selectionEnd).toBe(2);
    expect(percentageInput(container)).toBe(input);
    expect(container.textContent).toContain("still unallocated");
    expect(editButton(container)).toBeNull();
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
    expect(probe.schedule.rows[0]?.amount).toEqual({ type: "percent", percent: "10" });
    expect(probe.persisted).toBe(0);

    typePercentage(input, "100", 3);

    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("100");
    expect(input.selectionStart).toBe(3);
    expect(percentageInput(container)).toBe(input);
    expect(container.textContent).not.toContain("still unallocated");
    expect(editButton(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
    expect(probe.persisted).toBe(0);

    typePercentage(input, "1000", 4);

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("1000");
    expect(input.selectionStart).toBe(4);
    expect(percentageInput(container)).toBe(input);
    expect(container.textContent).toContain("They currently total 1000%");
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
    expect(probe.schedule.rows[0]?.amount).toEqual({ type: "percent", percent: "1000" });
  });

  it("keeps the same percentage input while an invalid schedule becomes valid", () => {
    const initial = fullAdvanceTemplate();
    const row = initial.rows[0];
    if (!row || row.amount.type !== "percent") throw new Error("Expected a percentage row");
    row.amount = { type: "percent", percent: "10" };
    const rowId = row.id;
    const { container, probe } = renderEditor({ initial, grandTotal: "100.00" });
    expect(container.textContent).toContain("still unallocated");
    expect(editButton(container)).toBeNull();
    const input = percentageInput(container);
    input.focus();
    input.setSelectionRange(2, 2);

    typePercentage(input, "100", 3);

    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("100");
    expect(input.selectionStart).toBe(3);
    expect(percentageInput(container)).toBe(input);
    expect(container.textContent).not.toContain("still unallocated");
    expect(editButton(container)?.getAttribute("aria-expanded")).toBe("true");
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
    expect(probe.persisted).toBe(0);

    typePercentage(input, "100.", 4);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("100.");
    expect(input.selectionStart).toBe(4);
    expect(percentageInput(container)).toBe(input);
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
  });

  it("opens and closes without saving, discarding, or persisting the schedule", () => {
    const initial = fullAdvanceTemplate();
    const rowId = initial.rows[0]?.id;
    const { container, probe } = renderEditor({ initial, grandTotal: "100.00" });
    const open = editButton(container);
    if (!open) throw new Error("Edit payment schedule missing");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    click(open);
    const input = percentageInput(container);
    expect(input.value).toBe("100");
    expect(probe.edits).toBe(0);
    expect(probe.persisted).toBe(0);

    const close = editButton(container);
    if (!close) throw new Error("Edit payment schedule missing while open");
    expect(close.getAttribute("aria-expanded")).toBe("true");
    click(close);

    expect(container.textContent).not.toContain("Percentage");
    expect(probe.edits).toBe(0);
    expect(probe.persisted).toBe(0);
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
    expect(probe.schedule.rows[0]?.amount).toEqual({ type: "percent", percent: "100" });

    const reopen = editButton(container);
    if (!reopen) throw new Error("Edit payment schedule missing after close");
    click(reopen);
    expect(percentageInput(container).value).toBe("100");
    expect(probe.schedule.rows.map((row) => row.id)).toEqual([rowId]);
    expect(probe.edits).toBe(0);
    expect(probe.persisted).toBe(0);
  });

  it("keeps allocation and date-review warnings visible while the same inputs stay mounted", () => {
    const initial = fullAdvanceTemplate();
    initial.dates_need_review = true;
    const rowId = initial.rows[0]?.id;
    const allocationMessage = "These charges belong to the subscription advance.";
    const { container, probe } = renderEditor({
      initial,
      grandTotal: "100.00",
      allocationNote: allocationMessage,
    });
    expect(container.textContent).toContain("Fixed dates and before-shipment deadlines were cleared");
    expect(container.textContent).toContain(allocationMessage);
    expect(editButton(container)).toBeNull();
    const input = percentageInput(container);
    input.focus();

    typePercentage(input, "10", 2);

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("10");
    expect(percentageInput(container)).toBe(input);
    expect(container.textContent).toContain("Fixed dates and before-shipment deadlines were cleared");
    expect(container.textContent).toContain(allocationMessage);
    expect(container.textContent).toContain("still unallocated");
    expect(probe.schedule.rows[0]?.id).toBe(rowId);
    expect(probe.schedule.dates_need_review).toBe(true);
    expect(probe.persisted).toBe(0);
  });
});

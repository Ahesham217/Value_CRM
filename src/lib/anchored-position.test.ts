import { describe, expect, it } from "vitest";
import { anchoredPanelStyle } from "./anchored-position";

const viewport = { width: 1000, height: 800 };

describe("anchoredPanelStyle", () => {
  it("opens below a control and grows to the minimum width", () => {
    const placed = anchoredPanelStyle(
      { left: 100, right: 300, top: 100, bottom: 140, width: 200 },
      viewport,
      { align: "start", matchWidth: true, minWidth: 240 },
    );
    expect(placed.top).toBe(144);
    expect(placed.bottom).toBeUndefined();
    expect(placed.left).toBe(100);
    expect(placed.width).toBe(240);
  });

  it("opens above the control when there is not enough room below", () => {
    const placed = anchoredPanelStyle(
      { left: 100, right: 280, top: 700, bottom: 760, width: 180 },
      viewport,
      { align: "start", matchWidth: true, minWidth: 160 },
    );
    expect(placed.top).toBeUndefined();
    expect(placed.bottom).toBe(104);
    expect(placed.maxHeight).toBeGreaterThan(0);
  });

  it("keeps an end-aligned panel inside the viewport", () => {
    const placed = anchoredPanelStyle(
      { left: 900, right: 1000, top: 40, bottom: 70, width: 100 },
      viewport,
      { align: "end", matchWidth: false, minWidth: 220 },
    );
    expect(placed.width).toBe(220);
    expect(placed.left).toBe(772);
    expect(placed.left + placed.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it("does not place a panel past the left edge", () => {
    const placed = anchoredPanelStyle(
      { left: 0, right: 40, top: 40, bottom: 70, width: 40 },
      viewport,
      { align: "start", matchWidth: true, minWidth: 240 },
    );
    expect(placed.left).toBe(8);
  });
});

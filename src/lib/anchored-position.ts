export type AnchorRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
};

export type AnchoredOptions = {
  align: "start" | "end";
  matchWidth: boolean;
  minWidth: number;
};

export type AnchoredPlacement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

/** Place a floating panel in the viewport so it stays visible beside its control. */
export function anchoredPanelStyle(
  rect: AnchorRect,
  viewport: { width: number; height: number },
  options: AnchoredOptions,
): AnchoredPlacement {
  const margin = 8;
  const maxWidth = Math.max(120, viewport.width - margin * 2);
  let width = options.matchWidth ? Math.max(rect.width, options.minWidth) : options.minWidth;
  width = Math.min(width, maxWidth);
  let left = options.align === "end" ? rect.right - width : rect.left;
  if (left + width > viewport.width - margin) left = viewport.width - margin - width;
  if (left < margin) left = margin;

  const spaceBelow = viewport.height - rect.bottom;
  const spaceAbove = rect.top;
  const placeAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
  const available = Math.max(0, (placeAbove ? spaceAbove : spaceBelow) - 12);
  const maxHeight = Math.max(96, Math.min(320, available));
  if (placeAbove) {
    return { left, width, maxHeight, bottom: viewport.height - rect.top + 4 };
  }
  return { left, width, maxHeight, top: rect.bottom + 4 };
}

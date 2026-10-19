import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { anchoredPanelStyle, type AnchoredOptions } from "../lib/anchored-position";

export function useAnchoredStyle(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  options: AnchoredOptions,
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", zIndex: 70 });

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const element = anchorRef.current;
      if (!element) return;
      const placed = anchoredPanelStyle(
        element.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        options,
      );
      setStyle({
        position: "fixed",
        zIndex: 70,
        left: placed.left,
        width: placed.width,
        maxHeight: placed.maxHeight,
        top: placed.top,
        bottom: placed.bottom,
      });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, open, options.align, options.matchWidth, options.minWidth]);

  return style;
}

/** Normalize database numeric values for controlled decimal text inputs.
 * Preserve missing values as blank and explicit zero as "0".
 * Do not parse/re-round decimal strings at the input boundary.
 */
export function numericInputValue(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

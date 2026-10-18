export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Something went wrong. Please try again.";
}

export function isConflict(error: unknown): boolean {
  return errorText(error).toLowerCase().includes("updated by someone else");
}

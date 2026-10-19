import { describe, expect, it, vi } from "vitest";
import {
  DELETE_CONFIRMATION,
  formatPiPdfReport,
  isGeneratedPiPdfName,
  PI_PDF_BUCKET,
  runPiPdfCleanup,
  summarizePiPdfObjects,
} from "./pi-pdf-cleanup";

describe("PI PDF cleanup selection", () => {
  it("identifies only generated PI PDFs and totals their size", () => {
    const summary = summarizePiPdfObjects([
      { name: "be581e32-c5ca-4639-a362-7d29c56653f6.pdf", id: "1", metadata: { size: 58 } },
      { name: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE.pdf", id: "2", metadata: { size: 1000 } },
      { name: "logo.png", id: "3", metadata: { size: 400 } },
      { name: "invoices/not-a-root-object.pdf", id: "4", metadata: { size: 10 } },
      { name: "notes.txt", id: "5", metadata: { size: 4 } },
      { name: "nested", id: null, metadata: null },
    ]);

    expect(isGeneratedPiPdfName("be581e32-c5ca-4639-a362-7d29c56653f6.pdf")).toBe(true);
    expect(summary.bucket).toBe(PI_PDF_BUCKET);
    expect(summary.count).toBe(2);
    expect(summary.totalBytes).toBe(1058);
    expect(summary.generated.map((file) => file.name)).toEqual([
      "be581e32-c5ca-4639-a362-7d29c56653f6.pdf",
      "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE.pdf",
    ]);
    expect(summary.skipped).toEqual(["logo.png", "invoices/not-a-root-object.pdf", "notes.txt", "nested"]);
    expect(formatPiPdfReport(summary)).toContain("Deletion: not requested");
    expect(formatPiPdfReport(summary)).toContain("Total size: 1058 bytes");
  });

  it("reports without deleting, and refuses to delete unrelated objects", async () => {
    const objects = [
      { name: "be581e32-c5ca-4639-a362-7d29c56653f6.pdf", id: "1", metadata: { size: 58 } },
      { name: "logo.png", id: "2", metadata: { size: 12 } },
    ];
    const remove = vi.fn();
    const storage = {
      from: (bucket: string) => {
        expect(bucket).toBe(PI_PDF_BUCKET);
        return {
          list: vi.fn().mockResolvedValue({ data: objects, error: null }),
          remove,
        };
      },
    };
    const lines: string[] = [];
    const report = await runPiPdfCleanup({
      argv: ["node", "pi-pdf-cleanup.mjs"],
      env: {},
      stdout: (line: string) => lines.push(line),
      storage,
    });
    expect(report.deleted).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("Generated PI PDFs: 1");
    expect(lines.join("\n")).toContain("Total size: 58 bytes");

    await expect(
      runPiPdfCleanup({
        argv: ["node", "pi-pdf-cleanup.mjs", "--delete"],
        env: { CONFIRM_PI_PDF_CLEANUP: DELETE_CONFIRMATION },
        stdout: () => undefined,
        storage,
      }),
    ).rejects.toThrow(/Nothing was deleted/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes only matching names after an explicit confirmation", async () => {
    const name = "be581e32-c5ca-4639-a362-7d29c56653f6.pdf";
    const remove = vi.fn().mockResolvedValue({ data: [{ name }], error: null });
    const storage = {
      from: () => ({
        list: vi.fn().mockResolvedValue({
          data: [{ name, id: "1", metadata: { size: 58 } }],
          error: null,
        }),
        remove,
      }),
    };
    const result = await runPiPdfCleanup({
      argv: ["node", "pi-pdf-cleanup.mjs", "--delete"],
      env: { CONFIRM_PI_PDF_CLEANUP: DELETE_CONFIRMATION },
      stdout: () => undefined,
      storage,
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([name]);
    expect(result.deleted).toEqual([name]);
  });

  it("does not delete when confirmation is missing", async () => {
    const remove = vi.fn();
    await expect(
      runPiPdfCleanup({
        argv: ["node", "pi-pdf-cleanup.mjs", "--delete"],
        env: {},
        stdout: () => undefined,
        storage: { from: () => ({ list: vi.fn(), remove }) },
      }),
    ).rejects.toThrow(/Refusing to delete/);
    expect(remove).not.toHaveBeenCalled();
  });
});

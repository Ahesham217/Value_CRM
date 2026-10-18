declare module "pdfmake/build/pdfmake" {
  type PdfDocument = {
    getBuffer: () => Promise<Uint8Array>;
    getBlob: () => Promise<Blob>;
    download: (filename?: string) => void;
    open: () => void;
  };

  const pdfMake: {
    addVirtualFileSystem: (vfs: Record<string, string>) => void;
    addFonts: (
      fonts: Record<
        string,
        { normal: string; bold: string; italics: string; bolditalics: string }
      >,
    ) => void;
    createPdf: (definition: unknown) => PdfDocument;
  };

  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}

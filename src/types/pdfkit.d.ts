declare module "pdfkit" {
  import { Readable } from "stream";

  export interface PDFDocumentOptions {
    size?: string | [number, number];
    margin?: number;
    layout?: "portrait" | "landscape";
  }

  class PDFDocument extends Readable {
    constructor(options?: PDFDocumentOptions);
    y: number;

    font(name: string): this;
    fontSize(size: number): this;
    // Overloads: allow passing only options without x/y
    text(text: string, options?: any): this;
    text(text: string, x?: number, y?: number, options?: any): this;
    image(src: any, x?: number, y?: number, options?: any): this;
    addPage(options?: any): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    end(): void;

    on(event: "data", listener: (chunk: Buffer | string) => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "end", listener: () => void): this;
  }

  export default PDFDocument;
}

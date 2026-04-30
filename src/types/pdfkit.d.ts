// -nocheck
// @ts-ignore
declare class PDFDocument {
  constructor(options?: {
    autoFirstPage?: boolean;
    size?: string | [number, number];
    layout?: 'portrait' | 'landscape';
    margin?: number;
    margins?: { top?: number; bottom?: number; left?: number; right?: number };
    info?: Record<string, string>;
  });
  pipe<T extends { write: (chunk: Buffer) => void }>(out: T): T;
  font(path: string): this;
  fontSize(size: number): this;
  text(text: string, x?: number, y?: number, options?: Record<string, unknown>): this;
  moveDown(lines?: number): this;
  fillColor(color: string): this;
  rect(x: number, y: number, width: number, height: number): this;
  fill(fillRule?: string): this;
  image(path: string, x?: number, y?: number, options?: Record<string, unknown>): this;
  addPage(options?: Record<string, unknown>): this;
  widthOfString(text: string): number;
  heightOfString(text: string): number;
  on(event: string, handler: (data: unknown) => void): this;
  end(): void;
}

export = PDFDocument;

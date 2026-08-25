// 這些套件缺少 TypeScript 型別宣告
declare module "markdown-it-footnote";
declare module "markdown-it-task-lists";
declare module "markdown-it-emoji";
declare module "markdown-it-sub";
declare module "markdown-it-sup";
declare module "markdown-it-deflist";
declare module "papaparse" {
  export interface ParseResult {
    data: unknown[][];
    errors: unknown[];
    meta: Record<string, unknown>;
  }
  interface ParseConfig {
    skipEmptyLines?: boolean;
    delimiter?: string;
    header?: boolean;
    [key: string]: unknown;
  }
  const Papa: {
    parse(text: string, config?: ParseConfig): ParseResult;
    unparse(data: unknown, config?: ParseConfig): string;
  };
  export default Papa;
}

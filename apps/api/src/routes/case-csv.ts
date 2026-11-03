export interface ParsedCsvCase {
  readonly id: string;
  readonly sessionId: string;
  readonly similarityGroup: string;
  readonly content: string;
}

const requiredColumns = ["id", "sessionId", "similarityGroup", "content"] as const;
const MAX_CASES = 40;

function parseRecords(source: string): string[][] {
  const text = source.replace(/^\uFEFF/u, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  // `quoted` e `closedQuote` formam a máquina de estados mínima do CSV: aspas podem conter vírgulas/quebras de linha;
  // depois da aspa de fechamento, apenas separador, fim de registro ou fim do arquivo são válidos.
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += character;
      }
      continue;
    }
    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("CASE_CSV_INVALID");
    }
    if (character === '"') {
      if (field.length !== 0 || closedQuote) throw new Error("CASE_CSV_INVALID");
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r") {
        if (text[index + 1] !== "\n") throw new Error("CASE_CSV_INVALID");
        index += 1;
      }
      record.push(field);
      if (record.some((value) => value.trim().length > 0)) records.push(record);
      record = [];
      field = "";
      closedQuote = false;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CASE_CSV_INVALID");
  if (field.length > 0 || record.length > 0 || closedQuote) {
    record.push(field);
    if (record.some((value) => value.trim().length > 0)) records.push(record);
  }
  return records;
}

export function parseCaseCsv(source: string): readonly ParsedCsvCase[] {
  const records = parseRecords(source);
  const header = records.shift()?.map((value) => value.trim());
  if (header === undefined || new Set(header).size !== header.length || requiredColumns.some((column) => !header.includes(column))) {
    throw new Error("CASE_CSV_INVALID");
  }
  if (records.length === 0 || records.length > MAX_CASES) throw new Error("CASE_CSV_SIZE_INVALID");
  // As colunas podem vir em qualquer ordem; os nomes, não a posição, definem o mapeamento.
  const indexes = Object.fromEntries(requiredColumns.map((column) => [column, header.indexOf(column)])) as Record<(typeof requiredColumns)[number], number>;
  return records.map((record) => {
    if (record.length !== header.length) throw new Error("CASE_CSV_INVALID");
    const item = Object.fromEntries(requiredColumns.map((column) => [column, record[indexes[column]]!.trim()])) as unknown as ParsedCsvCase;
    if (requiredColumns.some((column) => item[column].length === 0)) throw new Error("CASE_CSV_INVALID");
    return item;
  });
}
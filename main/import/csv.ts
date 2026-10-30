/* ============================================================
   CSV reader for bank statements (RFC 4180), with no dependency.
   Returns the header row and every record keyed by header name.
   ============================================================ */

export interface CsvFile {
  header: string[];
  records: Array<Record<string, string>>;
}

/** Splits the text into rows of fields. A field in double quotes may hold
 *  commas and line breaks, and "" inside it stands for one quote. */
function readRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      // CRLF: the \n that follows ends the row.
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseCsv(text: string): CsvFile {
  // Some exports (Revolut's) start with a UTF-8 byte-order mark.
  // A blank line (trailing ones, mostly) is not a record.
  const rows = readRows(text.replace(/^﻿/, '')).filter(
    (cells) => !(cells.length === 1 && cells[0] === '')
  );
  // A header line ending in commas (some Lloyds exports) names nothing
  // after them: those empty names are not columns.
  const header = [...(rows[0] ?? [])];
  while (header.length > 0 && header[header.length - 1].trim() === '') header.pop();
  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, i) => (record[name] = cells[i] ?? ''));
    return record;
  });
  return { header, records };
}

// Generador de archivos .xlsx (Excel) SIN dependencias externas.
//
// Un .xlsx es un ZIP con varios XML (formato OOXML). Aquí armamos ese ZIP a mano
// usando solo `zlib` de Node, para no agregar una librería pesada al proyecto y
// no depender de paquetes con vulnerabilidades conocidas. El resultado abre nativo
// en Excel, Numbers, LibreOffice y Google Sheets.
//
// Uso: buildWorkbook([{ name: "Hoja", headers: [...], rows: [[...], ...] }]) -> Buffer
//
// SOLO servidor (usa Buffer/zlib): impórtese desde route handlers o Server Components.

import { deflateRawSync } from "zlib";

export type Cell = string | number | null | undefined;
export type Sheet = { name: string; headers: string[]; rows: Cell[][] };

// ---------- ZIP mínimo (store/deflate) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type ZipEntry = { name: string; data: Buffer };

function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const comp = deflateRawSync(e.data);
    const deflate = comp.length < e.data.length;
    const stored = deflate ? comp : e.data;
    const method = deflate ? 8 : 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // local file header sig
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // flag bit 11 = UTF-8 names
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0x21, 12); // mod date (1980-01-01, válido)
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(stored.length, 18); // comprimido
    lh.writeUInt32LE(e.data.length, 22); // sin comprimir
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len
    locals.push(lh, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central dir sig
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0x21, 14); // date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // offset del local header
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central dir
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16); // offset del central dir
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ---------- XML del workbook ----------

function esc(s: string): string {
  // Escapa entidades XML y elimina caracteres de control no válidos en XML 1.0.
  return s
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Referencia de columna estilo Excel: 0->A, 25->Z, 26->AA...
function colRef(n: number): string {
  let s = "";
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Excel limita el nombre de hoja a 31 chars y prohíbe []:*?/\
function sheetName(name: string, i: number): string {
  const clean = (name || `Hoja ${i + 1}`).replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return clean || `Hoja ${i + 1}`;
}

function cellXml(value: Cell, ref: string, bold: boolean): string {
  const s = bold ? ' s="1"' : "";
  if (value == null || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rowsXml: string[] = [];
  const allRows: Cell[][] = [sheet.headers, ...sheet.rows];
  allRows.forEach((row, r) => {
    const isHeader = r === 0;
    const cells = row.map((v, c) => cellXml(v, `${colRef(c)}${r + 1}`, isHeader)).join("");
    rowsXml.push(`<row r="${r + 1}">${cells}</row>`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowsXml.join("")}</sheetData></worksheet>`
  );
}

const CONTENT_TYPES = (n: number) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("") +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

// Estilos mínimos: índice 0 = normal, índice 1 = negrita (para encabezados).
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
  `<borders count="1"><border/></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookXml(sheets: Sheet[]): string {
  const sheetTags = sheets
    .map((s, i) => `<sheet name="${esc(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheetTags}</sheets></workbook>`
  );
}

function workbookRels(sheets: Sheet[]): string {
  const rels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const stylesRel = `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels +
    stylesRel +
    `</Relationships>`
  );
}

/** Arma un libro de Excel (.xlsx) con una o varias hojas. Devuelve el Buffer del archivo. */
export function buildWorkbook(sheets: Sheet[]): Buffer {
  const safe = sheets.length ? sheets : [{ name: "Hoja 1", headers: [], rows: [] }];
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES(safe.length), "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml(safe), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRels(safe), "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES, "utf8") },
    ...safe.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(sheetXml(s), "utf8"),
    })),
  ];
  return zip(entries);
}

/**
 * Excel จำลองสำหรับทดสอบ Office Script ใน doc-numbering/
 *
 * ทำเฉพาะส่วนของ ExcelScript API ที่สคริปต์ใช้จริง ค่าว่างคืนเป็น "" เหมือน Excel
 * getUsedRange เริ่มจากเซลล์แรกที่มีค่า ไม่ใช่ A1 เสมอ เหมือน Excel จริง
 * เพื่อให้จับข้อผิดพลาดของสคริปต์ที่ลืมบวกตำแหน่งเริ่มต้นได้
 *
 * โหลดสคริปต์ .ts โดยตัด type ออกด้วย stripTypeScriptTypes ของ Node
 * สคริปต์จึงถูกทดสอบในรูปที่วางลง Excel จริง ไม่ต้องมีสำเนาแยก
 */
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');

const MAX_COL = 16384;

const ExcelScript = {
  InsertShiftDirection: { down: 'Down', right: 'Right' },
  DeleteShiftDirection: { up: 'Up', left: 'Left' },
  RangeCopyType: { all: 'All', formats: 'Formats', values: 'Values', formulas: 'Formulas' },
};

function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseAddress(addr) {
  const rows = addr.match(/^(\d+):(\d+)$/);
  if (rows) return [Number(rows[1]) - 1, 0, Number(rows[2]) - Number(rows[1]) + 1, MAX_COL];
  const [a, b = a] = addr.split(':');
  const p = s => { const m = s.match(/^([A-Z]+)(\d+)$/i); return [Number(m[2]) - 1, colIndex(m[1])]; };
  const [r1, c1] = p(a);
  const [r2, c2] = p(b);
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

// ตัวจัดรูปแบบตอบรับทุกคำสั่งและคืนตัวเองเพื่อต่อสายได้ เช่น getFormat().getFont().setBold()
function formatStub() {
  const p = new Proxy(function () {}, { get: () => () => p, apply: () => p });
  return p;
}

class Sheet {
  constructor(name, grid = []) {
    this.name = name;
    this.cells = new Map(); // "r,c" → { v, f, fmt }
    this.validations = {};
    grid.forEach((row, r) => row.forEach((v, c) => {
      if (v !== '' && v !== null && v !== undefined) this.put(r, c, { v });
    }));
  }
  put(r, c, cell) { this.cells.set(`${r},${c}`, cell); }
  get(r, c) { return this.cells.get(`${r},${c}`); }
  getName() { return this.name; }
  getRange(addr) { return new Range(this, ...parseAddress(addr)); }
  getRangeByIndexes(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  getCell(r, c) { return new Range(this, r, c, 1, 1); }
  getUsedRange(valuesOnly) {
    let r1 = Infinity, c1 = Infinity, r2 = -1, c2 = -1;
    for (const [k, cell] of this.cells) {
      if (valuesOnly && (cell.v === '' || cell.v === undefined)) continue;
      const [r, c] = k.split(',').map(Number);
      r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c);
    }
    return r2 < 0 ? undefined : new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
  }
  shiftRows(from, by) {
    const moved = new Map();
    for (const [k, cell] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (by < 0 && r >= from && r < from - by) continue; // แถวที่ถูกลบ
      moved.set(`${r >= from ? r + by : r},${c}`, cell);
    }
    this.cells = moved;
  }
  // ค่าทั้งชีตเป็นตาราง ใช้ตรวจผลในชุดทดสอบ
  dump() {
    const used = this.getUsedRange(true);
    if (!used) return [];
    return this.getRangeByIndexes(0, 0, used.r + used.nr, used.c + used.nc).getValues();
  }
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < Math.min(this.nc, 200); j++) fn(this.r + i, this.c + j, i, j); }
  getValues() {
    const out = Array.from({ length: this.nr }, () => Array(this.nc).fill(''));
    this.each((r, c, i, j) => { const cell = this.sheet.get(r, c); if (cell && cell.v !== undefined) out[i][j] = cell.v; });
    return out;
  }
  getFormulas() {
    const out = this.getValues();
    this.each((r, c, i, j) => { const cell = this.sheet.get(r, c); if (cell && cell.f) out[i][j] = cell.f; });
    return out;
  }
  setValues(values) {
    if (values.length !== this.nr || values.some(row => row.length !== this.nc)) {
      throw new Error(`setValues: ขนาด ${values.length}×${values[0] && values[0].length} ไม่ตรงกับช่วง ${this.nr}×${this.nc}`);
    }
    this.each((r, c, i, j) => {
      const old = this.sheet.get(r, c) || {};
      this.sheet.put(r, c, { fmt: old.fmt, v: values[i][j] });
    });
  }
  setValue(v) { this.setValues([[v]]); }
  getValue() { return this.getValues()[0][0]; }
  setFormula(f) { const old = this.sheet.get(this.r, this.c) || {}; this.sheet.put(this.r, this.c, { fmt: old.fmt, f, v: 0 }); }
  setNumberFormat(fmt) {
    this.each((r, c) => { const cell = this.sheet.get(r, c) || { v: '' }; cell.fmt = fmt; this.sheet.put(r, c, cell); });
  }
  getNumberFormat() { const cell = this.sheet.get(this.r, this.c); return cell && cell.fmt; }
  getRowIndex() { return this.r; }
  getColumnIndex() { return this.c; }
  getRowCount() { return this.nr; }
  getColumnCount() { return this.nc; }
  getEntireRow() { return new Range(this.sheet, this.r, 0, this.nr, MAX_COL); }
  insert() { this.sheet.shiftRows(this.r, this.nr); return this; }
  delete() { this.sheet.shiftRows(this.r, -this.nr); }
  getFormat() { return formatStub(); }
  // คัดลอกรูปแบบ — จำไว้ให้ชุดทดสอบตรวจว่าช่องไหนได้รูปแบบจากช่องไหน
  copyFrom(source, type) { (this.sheet.copies = this.sheet.copies || []).push({ to: [this.r, this.c], from: [source.r, source.c], type }); }
  getDataValidation() {
    const key = `${this.r},${this.c}`;
    const v = this.sheet.validations;
    return { clear: () => { delete v[key]; }, setRule: rule => { v[key] = rule; } };
  }
}

class Workbook {
  constructor(sheets) { this.sheets = sheets; }
  getWorksheet(name) { return this.sheets.find(s => s.name === name); }
  getWorksheets() { return this.sheets.slice(); }
}

// โหลด Office Script แล้วคืนฟังก์ชันที่ต้องการทดสอบ
function loadScript(path, names) {
  const src = stripTypeScriptTypes(fs.readFileSync(path, 'utf8'));
  const body = `${src}\nreturn { ${names.join(', ')} };`;
  return new Function('ExcelScript', 'console', body)(ExcelScript, { log() {} });
}

module.exports = { Sheet, Workbook, loadScript, ExcelScript };

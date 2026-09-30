/**
 * ตั้งค่าระบบครั้งแรก — เตรียมไฟล์ที่ย้ายมาจาก Google Sheets ให้พร้อมใช้บน Excel
 *
 * รันครั้งเดียวหลังย้ายไฟล์ รันซ้ำได้โดยไม่เกิดผลซ้ำซ้อน
 *   1. หน้าหลัก — ใส่รายการให้เลือกแผนก ประเภท และผู้บันทึก (ดึงจากชีตแอดมิน)
 *      เพิ่มช่องรหัสพนักงาน/เลขต้นทาง วันที่ในหนังสือ หมายเหตุ และช่องแสดงเลขที่ได้
 *   2. ตั้งค่า — ปีแสดงเป็นสูตรตามวันที่ปัจจุบัน และเติมตัวอย่างเลขที่ยังขาด
 *   3. ชีตข้อมูลทุกชีต — แก้วันที่ที่ปีเพี้ยนจากการนำเข้า ลบแถวว่างที่มีแต่ "NaT"
 *      และตั้งรูปแบบวันที่เป็นภาษาไทย
 *   4. รายงานเลขซ้ำของปีนี้ ให้ตามแก้ด้วยมือ (ไม่แก้ให้เอง เพราะเลขออกไปแล้ว)
 *
 * ก่อนรันครั้งแรก ไฟล์บน OneDrive มีประวัติเวอร์ชันให้ย้อนกลับได้เสมอ
 * (ไฟล์ → ข้อมูล → ประวัติเวอร์ชัน)
 */

const HOME = '🏠 หน้าหลัก';
const MASTER = '📊 Master Log';
const ADMIN = '👥 แอดมิน';
const SETTINGS = '⚙️ ตั้งค่า';

const DATE_FORMAT = '[$-41E]d mmm bbbb';

// ต้องตรงกับ TYPES และ DEPTS ใน เพิ่มหนังสือใหม่.ts
const TYPE_CHOICES = 'IN - บันทึกภายใน,OUT - หนังสือออก-ภายนอก,RECV - หนังสือรับ-ภายนอก,WARN - หนังสือเตือน';
const DEPT_CHOICES = 'PS - การโดยสาร,SS - บริการพิเศษ,BS - ติดตามสัมภาระ';

// ตัวอย่างเลขที่ชีตตั้งค่าเดิมยังไม่มี สคริปต์ออกเลขอ่านรูปแบบจากตัวอย่างเหล่านี้
const EXTRA_FORMATS: string[][] = [
  ['หนังสือเตือน (BS)', 'AOTGA-LL-HKT-LLW-001-2569'],
  ['หนังสือรับ-ภายนอก (PS)', 'รับเลข 001/2569 (OS)'],
  ['หนังสือรับ-ภายนอก (SS)', 'รับเลข 001/2569 (OSS)'],
  ['หนังสือรับ-ภายนอก (BS)', 'รับเลข 001/2569 (LL)'],
];

// ช่องที่เพิ่มในหน้าหลัก ป้ายต้องขึ้นต้นตรงกับ FORM_LABELS ใน เพิ่มหนังสือใหม่.ts
const NEW_FIELDS: string[][] = [
  ['รหัสพนักงาน / เลขหนังสือต้นทาง', 'หนังสือเตือน: รหัสพนักงาน · หนังสือรับ: เลขที่ของหนังสือที่รับเข้า'],
  ['วันที่ในหนังสือ', 'เฉพาะหนังสือรับ'],
  ['หมายเหตุ / ลิงก์ไฟล์', ''],
  ['✅ เลขที่ได้', ''],
];

// ปีในเซลล์วันที่ที่ถือว่าผิดแน่นอน (เอกสารระบบนี้เริ่มหลังปี 2000)
// ปี ≥ 2400 คือปี พ.ศ. ที่ถูกเก็บเป็นปี ค.ศ.  ปี 1900–1999 คือปี พ.ศ. สองหลัก
// (เช่น 69) ที่ถูกตีความเป็น 1969
const BE_YEAR_FLOOR = 2400;

type Cell = string | number | boolean;

function main(workbook: ExcelScript.Workbook): string {
  const report: string[] = [];

  setupHome(workbook, report);
  setupSettings(workbook, report);

  for (const sheet of workbook.getWorksheets()) {
    cleanSheet(sheet, report);
  }

  reportDuplicates(workbook, report);

  const text = report.length ? report.join('\n') : 'ไม่มีอะไรต้องแก้ ระบบพร้อมใช้งาน';
  console.log(text);
  return text;
}

// ---------- หน้าหลัก ----------

function setupHome(workbook: ExcelScript.Workbook, report: string[]) {
  const home = findSheet(workbook, HOME);
  if (!home) { report.push(`❌ ไม่พบชีต ${HOME}`); return; }

  let area = home.getRange('B1:B60').getValues().map(r => String(r[0]).trim());
  const rowOf = (label: string) => area.findIndex(v => v.startsWith(label));

  // เพิ่มช่องใหม่ใต้ช่อง "ถึง/จาก" โดยแทรกแถว ไม่ทับรายการล่าสุดที่อยู่ด้านล่าง
  if (rowOf('✅ เลขที่ได้') < 0) {
    const anchor = rowOf('ถึง/จาก');
    if (anchor < 0) {
      report.push('⚠️ ไม่พบช่อง "ถึง/จาก" ในหน้าหลัก จึงไม่ได้เพิ่มช่องใหม่');
    } else {
      const start = anchor + 2;
      const count = NEW_FIELDS.length * 2;
      home.getRangeByIndexes(start, 0, count, 1).getEntireRow().insert(ExcelScript.InsertShiftDirection.down);
      NEW_FIELDS.forEach((f, i) => {
        home.getCell(start + i * 2, 1).setValue(f[0]);
        home.getCell(start + i * 2, 3).setValue(f[1]);
      });
      report.push('เพิ่มช่องรหัสพนักงาน/เลขต้นทาง วันที่ในหนังสือ หมายเหตุ และเลขที่ได้ ในหน้าหลักแล้ว');
      area = home.getRange('B1:B60').getValues().map(r => String(r[0]).trim());
    }
  }

  // ข้อความวิธีใช้เดิมอ้างถึงเมนูของ Apps Script ซึ่งไม่มีใน Excel
  const hint = area.findIndex(v => v.startsWith('▶'));
  if (hint >= 0) {
    home.getCell(hint, 1).setValue('▶  กดปุ่ม "เพิ่มหนังสือใหม่" (หรือ Automate → เพิ่มหนังสือใหม่ → Run) เพื่อออกเลข');
  }

  styleNewFields(home, area);

  setList(home, rowOf('แผนก'), DEPT_CHOICES);
  setList(home, rowOf('ประเภทหนังสือ'), TYPE_CHOICES);
  const admin = findSheet(workbook, ADMIN);
  if (admin) setList(home, rowOf('ผู้บันทึก'), `='${admin.getName()}'!$C$2:$C$300`);

  const docDate = rowOf('วันที่ในหนังสือ');
  if (docDate >= 0) home.getCell(docDate, 2).setNumberFormat(DATE_FORMAT);
}

// ให้ช่องใหม่หน้าตาเหมือนช่อง "เรื่อง" (กรอบ สีพื้น ความสูงแถว) ทำทุกครั้งที่รัน
// ไฟล์ที่รันสคริปต์รุ่นก่อนไปแล้วจึงได้รูปแบบนี้ด้วยเมื่อรันซ้ำ
function styleNewFields(home: ExcelScript.Worksheet, area: string[]) {
  const source = area.findIndex(v => v.startsWith('เรื่อง'));
  if (source < 0) return;
  const height = home.getCell(source, 1).getFormat().getRowHeight();
  for (const f of NEW_FIELDS) {
    const row = area.findIndex(v => v.startsWith(f[0]));
    if (row < 0) continue;
    home.getRangeByIndexes(row, 1, 1, 2).copyFrom(home.getRangeByIndexes(source, 1, 1, 2), ExcelScript.RangeCopyType.formats);
    home.getCell(row, 1).getFormat().setRowHeight(height);
  }
  const result = area.findIndex(v => v.startsWith('✅ เลขที่ได้'));
  if (result >= 0) {
    const font = home.getCell(result, 2).getFormat().getFont();
    font.setBold(true);
    font.setSize(14);
  }
}

function setList(sheet: ExcelScript.Worksheet, row: number, source: string) {
  if (row < 0) return;
  const dv = sheet.getCell(row, 2).getDataValidation();
  dv.clear();
  dv.setRule({ list: { inCellDropDown: true, source: source } });
}

// ---------- ตั้งค่า ----------

function setupSettings(workbook: ExcelScript.Workbook, report: string[]) {
  const settings = findSheet(workbook, SETTINGS);
  if (!settings) { report.push(`⚠️ ไม่พบชีต ${SETTINGS} จะใช้รูปแบบเลขตั้งต้นในสคริปต์`); return; }
  const values = settings.getRange('A1:B40').getValues();
  const formulas = settings.getRange('A1:B40').getFormulas();

  const yearRow = values.findIndex(r => String(r[0]).startsWith('ปีงบประมาณ') || String(r[0]).startsWith('ปีที่ใช้'));
  if (yearRow >= 0 && !String(formulas[yearRow][1]).startsWith('=')) {
    settings.getCell(yearRow, 0).setValue('ปีที่ใช้ในเลขหนังสือ (พ.ศ.) — ตามวันที่ออกเลข');
    settings.getCell(yearRow, 1).setFormula('=YEAR(TODAY())+543');
  }

  const labels = values.map(r => String(r[0]).trim());
  let last = labels.reduce((acc, v, i) => (v ? i : acc), 0);
  for (const [label, example] of EXTRA_FORMATS) {
    if (labels.indexOf(label) >= 0) continue;
    last++;
    settings.getCell(last, 0).setValue(label);
    settings.getCell(last, 1).setValue(example);
    report.push(`เพิ่มรูปแบบเลข ${label} = ${example} ในชีตตั้งค่า`);
  }
}

// ---------- ล้างข้อมูลที่นำเข้า ----------

function cleanSheet(sheet: ExcelScript.Worksheet, report: string[]) {
  const used = sheet.getUsedRange(true);
  if (!used) return;
  const lastRow = used.getRowIndex() + used.getRowCount();
  const width = used.getColumnIndex() + used.getColumnCount();
  const values = sheet.getRangeByIndexes(0, 0, lastRow, width).getValues();
  const headerRow = values.findIndex((r, i) => i < 10 && String(r[0]).trim() === 'ลำดับ');
  if (headerRow < 0) return;
  const headers = values[headerRow].map(h => String(h).trim());
  const numberCol = headers.findIndex(h => h === 'เลขที่หนังสือ' || h === 'เลขรับ');
  const first = headerRow + 1;
  const count = lastRow - first;
  if (count <= 0) return;

  let fixed = 0;
  headers.forEach((h, c) => {
    if (!h.startsWith('วันที่')) return;
    const col = sheet.getRangeByIndexes(first, c, count, 1);
    const cells = col.getValues();
    let changed = false;
    const out = cells.map(r => {
      const v = r[0];
      if (typeof v !== 'number') return [v];
      const f = fixSerial(v);
      if (f !== v) { changed = true; fixed++; }
      return [f];
    });
    if (changed) col.setValues(out);
    col.setNumberFormat(DATE_FORMAT);
  });
  if (fixed) report.push(`${sheet.getName()}: แก้ปีของวันที่ ${fixed} เซลล์`);

  // แถวที่นำเข้าจากระบบเดิมแต่ไม่มีข้อมูลจริง (เลขที่ = "NaT") ลบจากล่างขึ้นบน
  // เพื่อไม่ให้ตำแหน่งแถวที่ยังไม่ได้ลบเลื่อน
  if (numberCol < 0) return;
  const junk: number[] = [];
  for (let i = 0; i < count; i++) {
    if (String(values[first + i][numberCol]).trim() === 'NaT') junk.push(first + i);
  }
  for (const [start, len] of runs(junk).reverse()) {
    sheet.getRangeByIndexes(start, 0, len, 1).getEntireRow().delete(ExcelScript.DeleteShiftDirection.up);
  }
  if (junk.length) report.push(`${sheet.getName()}: ลบแถวว่างจากการนำเข้า (NaT) ${junk.length} แถว`);
}

// รวมเลขแถวที่ติดกันเป็นช่วง [เริ่ม, จำนวน] จะได้ลบทีละช่วงแทนทีละแถว
function runs(rows: number[]): number[][] {
  const out: number[][] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last[0] + last[1] === r) last[1]++;
    else out.push([r, 1]);
  }
  return out;
}

// แก้เลขวันที่แบบ Excel ที่ปีเพี้ยน คืนค่าเดิมถ้าปกติดีอยู่แล้ว
function fixSerial(serial: number): number {
  const epoch = Date.UTC(1899, 11, 30);
  const d = new Date(epoch + Math.round(serial * 86400000));
  const y = d.getUTCFullYear();
  let shift = 0;
  if (y >= BE_YEAR_FLOOR) shift = -543;
  else if (y >= 1900 && y < 2000) shift = 57;
  if (!shift) return serial;
  // 29 ก.พ. ของปีที่ไม่มีวันนั้นจะเลื่อนเป็น 1 มี.ค. ซึ่งยอมรับได้
  const fixedMs = Date.UTC(y + shift, d.getUTCMonth(), d.getUTCDate());
  const frac = serial - Math.floor(serial);
  return (fixedMs - epoch) / 86400000 + frac;
}

// ---------- รายงานเลขซ้ำ ----------

function reportDuplicates(workbook: ExcelScript.Workbook, report: string[]) {
  const year = new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear() + 543;
  for (const sheet of workbook.getWorksheets()) {
    const line = duplicatesIn(sheet, year);
    if (line) report.push(line);
  }
}

// อ่านชีตเดียวแล้วคืนข้อความเลขซ้ำของปีนี้ แยกเป็นฟังก์ชันเพราะตัวตรวจของ
// Office Scripts เตือนเมื่อเรียกเมธอดอ่านค่าตรง ๆ ในลูป
function duplicatesIn(sheet: ExcelScript.Worksheet, year: number): string | undefined {
  const name = sheet.getName();
  if (/\d{4}\s*$/.test(name) || bareName(name) === bareName(MASTER)) return undefined;
  const used = sheet.getUsedRange(true);
  if (!used) return undefined;
  const values = sheet.getRangeByIndexes(0, 0, used.getRowIndex() + used.getRowCount(),
    used.getColumnIndex() + used.getColumnCount()).getValues();
  const headerRow = values.findIndex((r, i) => i < 10 && String(r[0]).trim() === 'ลำดับ');
  if (headerRow < 0) return undefined;
  const col = values[headerRow].findIndex(h => String(h).trim() === 'เลขที่หนังสือ' || String(h).trim() === 'เลขรับ');
  if (col < 0) return undefined;
  const seen: { [n: string]: number } = {};
  for (const r of values.slice(headerRow + 1)) {
    const n = String(r[col]).replace(/\s+/g, '');
    if (n && n.indexOf(String(year)) >= 0) seen[n] = (seen[n] || 0) + 1;
  }
  const dups = Object.keys(seen).filter(n => seen[n] > 1);
  if (!dups.length) return undefined;
  return `⚠️ ${name}: เลขซ้ำ ${dups.map(n => `${n} (${seen[n]} แถว)`).join(', ')}`;
}

// ---------- ชีต ----------

function findSheet(workbook: ExcelScript.Workbook, name: string): ExcelScript.Worksheet | undefined {
  const exact = workbook.getWorksheet(name);
  if (exact) return exact;
  const want = bareName(name);
  return workbook.getWorksheets().find(ws => bareName(ws.getName()) === want);
}

function bareName(name: string): string {
  return name.replace(/^[^\u0E00-\u0E7FA-Za-z0-9]+/, '').replace(/\s+/g, ' ').trim();
}

/**
 * เพิ่มหนังสือใหม่ — ออกเลขหนังสือถัดไปจากข้อมูลที่กรอกในชีต 🏠 หน้าหลัก
 *
 * Office Script สำหรับ Excel บนเว็บ (Microsoft 365) ทำหน้าที่แทน Apps Script เดิม
 *   1. อ่านแบบฟอร์มในหน้าหลัก — แผนก ประเภทหนังสือ ผู้บันทึก เรื่อง ...
 *   2. หาเลขล่าสุดของปีนี้ในชีตของแผนกและประเภทนั้น แล้วบวกหนึ่ง
 *   3. เขียนแถวใหม่ลงชีตนั้นและ 📊 Master Log
 *   4. แสดงเลขที่ได้ในหน้าหลัก ล้างช่องที่ต้องกรอกใหม่ และอัปเดตรายการล่าสุด
 *
 * เลขถัดไปนับจาก "เลขที่ปรากฏในชีตจริง" ไม่ได้เก็บตัวนับแยกไว้ที่อื่น
 * แถวที่ถูกลบหรือแก้เลขเองจึงไม่ทำให้ตัวนับเพี้ยน และเลขที่ยกเลิก
 * (สถานะ = ยกเลิก) ยังนับอยู่ จึงไม่ถูกนำกลับมาใช้ซ้ำ
 *
 * ปีในเลขหนังสือคือปี พ.ศ. ตามปฏิทินของวันที่กดออกเลข (เวลาประเทศไทย)
 * ขึ้นปีใหม่แล้วเลขเริ่มที่ 001 เองโดยไม่ต้องสร้างชีตใหม่
 *
 * ตรรกะส่วนหนึ่งซ้ำกับ ตั้งค่าระบบครั้งแรก.ts เพราะ Office Script
 * import ข้ามไฟล์ไม่ได้ แก้ที่ใดให้แก้อีกที่ให้ตรงกัน
 */

const HOME = '🏠 หน้าหลัก';
const MASTER = '📊 Master Log';
const ADMIN = '👥 แอดมิน';
const SETTINGS = '⚙️ ตั้งค่า';

// รูปแบบวันที่ไทย เช่น 29 ก.ย. 2569
const DATE_FORMAT = '[$-41E]d mmm bbbb';

// ประเทศไทยไม่มีเวลาออมแสง จึงบวก 7 ชั่วโมงตายตัวได้
const THAI_OFFSET_MS = 7 * 3600 * 1000;

interface DocType {
  code: string;
  label: string;
  sheet: string;
  // ชื่อที่อาจใช้ในชีตตั้งค่า เช่น "หนังสือภายนอก (PS)"
  settingLabels: string[];
  // รูปแบบเลขเมื่อชีตตั้งค่าไม่ได้ระบุ {D} = รหัสแผนกในเลขหนังสือ
  defaultFormat: string;
}

const TYPES: DocType[] = [
  { code: 'IN', label: 'บันทึกภายใน', sheet: '📥 บันทึกภายใน',
    settingLabels: ['บันทึกภายใน'], defaultFormat: 'AOTGA/{D}-HKT/{NNN}/{YYYY}' },
  { code: 'OUT', label: 'หนังสือออก-ภายนอก', sheet: '📤 หนังสือออก-ภายนอก',
    settingLabels: ['หนังสือออก-ภายนอก', 'หนังสือภายนอก'], defaultFormat: 'AOTGA/HKT-{D}/{NNN}/{YYYY}' },
  { code: 'RECV', label: 'หนังสือรับ-ภายนอก', sheet: '📨 หนังสือรับ-ภายนอก',
    settingLabels: ['หนังสือรับ-ภายนอก', 'หนังสือรับ'], defaultFormat: 'รับเลข {NNN}/{YYYY} ({D})' },
  { code: 'WARN', label: 'หนังสือเตือน', sheet: '⚠️ หนังสือเตือน',
    settingLabels: ['หนังสือเตือน'], defaultFormat: 'AOTGA-{D}-HKT-{D}W-{NNN}-{YYYY}' },
];

interface Dept {
  code: string;
  name: string;
  // รหัสที่ปรากฏในเลขหนังสือ
  short: string;
}

const DEPTS: Dept[] = [
  { code: 'PS', name: 'การโดยสาร', short: 'OS' },
  { code: 'SS', name: 'บริการพิเศษ', short: 'OSS' },
  { code: 'BS', name: 'ติดตามสัมภาระ', short: 'LL' },
];

// หัวคอลัมน์ในชีตข้อมูล → ช่องของรายการที่จะเขียน
// ชีตแต่ละประเภทใช้หัวคอลัมน์ต่างกันเล็กน้อย จึงจับคู่ด้วยชื่อหัวแทนตำแหน่ง
const HEADER_FIELDS: { [header: string]: string } = {
  'ลำดับ': 'seq',
  'วันที่': 'date',
  'วันที่รับ': 'date',
  'เลขที่หนังสือ': 'number',
  'เลขรับ': 'number',
  'ประเภท': 'typeLabel',
  'แผนก': 'deptName',
  'เรื่อง': 'subject',
  'ถึง (หน่วยงาน)': 'party',
  'ถึง/จาก': 'party',
  'จาก (หน่วยงาน)': 'party',
  'ชื่อพนักงาน': 'party',
  'รหัสพนักงาน': 'ref',
  'เลขหนังสือต้นทาง': 'ref',
  'วันที่ในหนังสือ': 'docDate',
  'ผู้บันทึก': 'author',
  'รหัสผู้บันทึก': 'authorCode',
  'สถานะ': 'status',
  'หมายเหตุ': 'note',
};

// ป้ายในคอลัมน์ B ของหน้าหลัก ค่าอยู่ในคอลัมน์ C แถวเดียวกัน
// หาจากข้อความป้ายแทนเลขแถว ย้ายแถวในหน้าหลักได้โดยไม่ต้องแก้สคริปต์
const FORM_LABELS: { [field: string]: string } = {
  dept: 'แผนก',
  type: 'ประเภทหนังสือ',
  author: 'ผู้บันทึก',
  subject: 'เรื่อง',
  party: 'ถึง/จาก',
  ref: 'รหัสพนักงาน',
  docDate: 'วันที่ในหนังสือ',
  note: 'หมายเหตุ',
  result: '✅ เลขที่ได้',
};

// ช่องที่ล้างหลังออกเลขสำเร็จ แผนก ประเภท และผู้บันทึกคงไว้ให้กรอกเล่มถัดไปเร็วขึ้น
const CLEAR_AFTER_SAVE = ['subject', 'party', 'ref', 'docDate', 'note'];

type Cell = string | number | boolean;

function main(workbook: ExcelScript.Workbook): string {
  const home = findSheet(workbook, HOME);
  if (!home) return `❌ ไม่พบชีต ${HOME}`;

  const formArea = home.getRange('B1:C60').getValues();
  const rows = locateForm(formArea);
  const form = readForm(formArea, rows);

  const say = (msg: string) => {
    if (rows.result !== undefined) home.getCell(rows.result, 2).setValue(msg);
    console.log(msg);
    return msg;
  };

  const type = TYPES.find(t => t.code === leadingCode(form.type));
  if (!type) return say('❌ เลือกประเภทหนังสือก่อน (IN / OUT / RECV / WARN)');
  const dept = DEPTS.find(d => d.code === leadingCode(form.dept));
  if (!dept) return say('❌ เลือกแผนกก่อน (PS / SS / BS)');
  if (!String(form.subject).trim()) return say('❌ กรอกเรื่องก่อน');

  const author = lookupAuthor(workbook, leadingCode(form.author));
  if (!author) return say(`❌ ไม่พบรหัสผู้บันทึก "${form.author}" ในชีต ${ADMIN} หรือสถานะไม่ใช่ Active`);

  const sheetName = `${type.sheet} (${dept.code})`;
  const sheet = findSheet(workbook, sheetName);
  if (!sheet) return say(`❌ ไม่พบชีต ${sheetName}`);

  const today = thaiToday(Date.now());
  const template = readTemplate(workbook, type, dept);

  const table = readTable(sheet);
  if (!table) return say(`❌ ไม่พบแถวหัวตาราง (ลำดับ) ในชีต ${sheetName}`);

  const record: { [field: string]: Cell } = {
    seq: nextSeq(table.rows, table.headers),
    date: today.serial,
    number: '',
    typeLabel: type.label,
    deptName: dept.name,
    subject: String(form.subject).trim(),
    party: String(form.party).trim(),
    ref: form.ref,
    docDate: form.docDate,
    author: author.name,
    authorCode: author.code,
    status: 'ปกติ',
    note: String(form.note).trim(),
  };

  // จองเลข: เขียนแถวลงไปก่อน แล้วอ่านกลับมาตรวจ เพราะสองคนกดพร้อมกันในไฟล์
  // ที่เปิดร่วมกันอาจเห็นเลขล่าสุดตัวเดียวกันและเขียนลงแถวเดียวกัน
  //   - แถวของเราถูกเขียนทับ → ต่อท้ายตารางใหม่ด้วยเลขถัดไป
  //   - แถวที่อยู่สูงกว่ามีเลขเดียวกัน → แถวบนได้เลขนั้นไป แถวเราขยับเป็นเลขถัดไป
  const numberCol = findColumn(table.headers, 'number');
  const subjectCol = findColumn(table.headers, 'subject');
  const rowAt = (t: Table, row: number): Cell[] => t.rows[row - t.headerRow - 1] || [];
  const isMine = (r: Cell[]) => String(r[numberCol]).trim() === number &&
    (subjectCol < 0 || String(r[subjectCol]).trim() === record.subject);
  let rowIndex = -1;
  let number = '';
  let saved = false;
  for (let attempt = 0; attempt < 5 && !saved; attempt++) {
    const current = (attempt === 0 ? table : readTable(sheet)) || table;
    const mine = rowIndex >= 0 && isMine(rowAt(current, rowIndex));
    if (!mine) rowIndex = current.headerRow + 1 + current.rows.length;
    const others = current.rows.filter((_, i) => current.headerRow + 1 + i !== rowIndex);
    const seq = nextNumber(others.map(r => r[numberCol]), template, dept.short, today.year);
    number = formatNumber(template, dept.short, seq, today.year);
    record.number = number;
    writeRecord(sheet, rowIndex, table.headers, record);

    const check = readTable(sheet) || current;
    const intact = isMine(rowAt(check, rowIndex));
    const clash = check.rows.some((r, i) =>
      check.headerRow + 1 + i < rowIndex && String(r[numberCol]).trim() === number);
    saved = intact && !clash;
  }
  if (!saved) return say('❌ มีคนออกเลขพร้อมกันหลายครั้ง ลองกดใหม่อีกครั้ง');

  appendMasterLog(workbook, record);

  for (const f of CLEAR_AFTER_SAVE) {
    if (rows[f] !== undefined) home.getCell(rows[f], 2).setValue('');
  }
  refreshRecent(workbook, home);
  say(number);
  console.log(`บันทึก ${number} ลงชีต ${sheetName} แล้ว`);
  return number;
}

// ---------- หน้าหลัก ----------

function locateForm(area: Cell[][]): { [field: string]: number } {
  const rows: { [field: string]: number } = {};
  for (const field of Object.keys(FORM_LABELS)) {
    const label = FORM_LABELS[field];
    for (let r = 0; r < area.length; r++) {
      if (String(area[r][0]).trim().startsWith(label)) { rows[field] = r; break; }
    }
  }
  return rows;
}

function readForm(area: Cell[][], rows: { [field: string]: number }): { [field: string]: Cell } {
  const form: { [field: string]: Cell } = {};
  for (const field of Object.keys(FORM_LABELS)) {
    form[field] = rows[field] === undefined ? '' : area[rows[field]][1];
  }
  return form;
}

// "IN - บันทึกภายใน" → IN, "ps" → PS
function leadingCode(value: Cell): string {
  return String(value).trim().split(/[\s\-–:]/)[0].toUpperCase();
}

function refreshRecent(workbook: ExcelScript.Workbook, home: ExcelScript.Worksheet) {
  const master = findSheet(workbook, MASTER);
  if (!master) return;
  const area = home.getRange('B1:E60').getValues();
  const top = area.findIndex(r => String(r[0]).trim() === 'วันที่' && String(r[1]).trim() === 'เลขที่หนังสือ');
  if (top < 0) return;
  const table = readTable(master);
  if (!table) return;
  const col = (f: string) => findColumn(table.headers, f);
  const recent = table.rows
    .filter(r => String(r[col('number')]).trim() !== '')
    .sort((a, b) => Number(b[col('seq')]) - Number(a[col('seq')]))
    .slice(0, 10)
    .map(r => [r[col('date')], r[col('number')], r[col('subject')], r[col('author')]]);
  while (recent.length < 10) recent.push(['', '', '', '']);
  const target = home.getRangeByIndexes(top + 1, 1, 10, 4);
  target.setValues(recent);
  home.getRangeByIndexes(top + 1, 1, 10, 1).setNumberFormat(DATE_FORMAT);
}

// ---------- ชีตข้อมูล ----------

interface Table {
  headerRow: number;
  headers: string[];
  rows: Cell[][];
}

// หาแถวหัวตาราง (แถวที่คอลัมน์ A เป็น "ลำดับ") แล้วอ่านข้อมูลทั้งหมดใต้แถวนั้น
function readTable(sheet: ExcelScript.Worksheet): Table | undefined {
  const used = sheet.getUsedRange(true);
  if (!used) return undefined;
  const lastRow = used.getRowIndex() + used.getRowCount();
  const width = used.getColumnIndex() + used.getColumnCount();
  const values = sheet.getRangeByIndexes(0, 0, lastRow, width).getValues();
  const headerRow = values.findIndex((r, i) => i < 10 && String(r[0]).trim() === 'ลำดับ');
  if (headerRow < 0) return undefined;
  const headers = values[headerRow].map(h => String(h).trim());
  let rows = values.slice(headerRow + 1);
  // ตัดแถวว่างท้ายตาราง เช่น แถวที่เหลือแต่รูปแบบหรือค่าที่ลบไปแล้ว
  while (rows.length && rows[rows.length - 1].every(c => c === '' || c === null)) rows = rows.slice(0, -1);
  return { headerRow, headers, rows };
}

function findColumn(headers: string[], field: string): number {
  return headers.findIndex(h => HEADER_FIELDS[h] === field);
}

function nextSeq(rows: Cell[][], headers: string[]): number {
  const col = findColumn(headers, 'seq');
  let max = 0;
  for (const r of rows) {
    const n = Number(r[col]);
    if (isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

function writeRecord(sheet: ExcelScript.Worksheet, rowIndex: number, headers: string[], record: { [field: string]: Cell }) {
  const values = headers.map(h => {
    const field = HEADER_FIELDS[h];
    const v = field ? record[field] : '';
    return v === undefined || v === null ? '' : v;
  });
  sheet.getRangeByIndexes(rowIndex, 0, 1, headers.length).setValues([values]);
  headers.forEach((h, c) => {
    const field = HEADER_FIELDS[h];
    if ((field === 'date' || field === 'docDate') && typeof record[field] === 'number') {
      sheet.getCell(rowIndex, c).setNumberFormat(DATE_FORMAT);
    }
  });
}

function appendMasterLog(workbook: ExcelScript.Workbook, record: { [field: string]: Cell }) {
  const master = findSheet(workbook, MASTER);
  if (!master) return;
  const table = readTable(master);
  if (!table) return;
  const entry = Object.assign({}, record, { seq: nextSeq(table.rows, table.headers) });
  writeRecord(master, table.headerRow + 1 + table.rows.length, table.headers, entry);
}

// ---------- ผู้บันทึก ----------

function lookupAuthor(workbook: ExcelScript.Workbook, code: string): { code: string; name: string } | undefined {
  if (!code) return undefined;
  const admin = findSheet(workbook, ADMIN);
  if (!admin) return undefined;
  const used = admin.getUsedRange(true);
  if (!used) return undefined;
  const values = admin.getRangeByIndexes(0, 0, used.getRowIndex() + used.getRowCount(),
    used.getColumnIndex() + used.getColumnCount()).getValues();
  const headers = values[0].map(h => String(h).trim());
  const cCode = headers.indexOf('รหัสย่อ (Code)');
  const cFirst = headers.indexOf('ชื่อ (TH)');
  const cLast = headers.indexOf('นามสกุล (TH)');
  const cStatus = headers.indexOf('สถานะ');
  const want = code.toUpperCase();
  for (const r of values.slice(1)) {
    if (String(r[cCode]).trim().toUpperCase() !== want) continue;
    if (cStatus >= 0 && String(r[cStatus]).trim() && String(r[cStatus]).trim().toLowerCase() !== 'active') return undefined;
    const name = [r[cFirst], r[cLast]].map(v => String(v).trim()).filter(v => v).join(' ');
    return { code: String(r[cCode]).trim(), name: name || String(r[cCode]).trim() };
  }
  return undefined;
}

// ---------- รูปแบบเลขหนังสือ ----------

// อ่านรูปแบบจากตัวอย่างในชีตตั้งค่า เช่น "บันทึกภายใน (PS)" → "AOTGA/OS-HKT/001/2569"
// แทน 001 ด้วยเลขลำดับและปี พ.ศ. ท้ายสุดด้วยปีปัจจุบัน ไม่มีตัวอย่างก็ใช้ค่าตั้งต้น
function readTemplate(workbook: ExcelScript.Workbook, type: DocType, dept: Dept): string {
  const settings = findSheet(workbook, SETTINGS);
  if (settings) {
    const values = settings.getRange('A1:B40').getValues();
    for (const r of values) {
      const label = String(r[0]).trim();
      if (type.settingLabels.some(l => label === `${l} (${dept.code})`)) {
        const t = templateFromExample(String(r[1]));
        if (t) return t;
      }
    }
  }
  return type.defaultFormat.split('{D}').join(dept.short);
}

function templateFromExample(example: string): string | undefined {
  const s = example.trim();
  const year = s.match(/25\d\d(?!.*25\d\d)/);
  if (!year || year.index === undefined) return undefined;
  const withYear = s.slice(0, year.index) + '{YYYY}' + s.slice(year.index + 4);
  if (withYear.indexOf('001') < 0) return undefined;
  return withYear.replace('001', '{NNN}');
}

function numberPattern(template: string, short: string, year: number): RegExp {
  const parts = template.split('{D}').join(short).split(/(\{NNN\}|\{YYYY\})/);
  let src = '';
  for (const p of parts) {
    if (p === '{NNN}') src += '\\s*(\\d+)\\s*';
    else if (p === '{YYYY}') src += String(year);
    else src += p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  }
  return new RegExp('^\\s*' + src + '\\s*$');
}

function nextNumber(existing: Cell[], template: string, short: string, year: number): number {
  const re = numberPattern(template, short, year);
  let max = 0;
  for (const v of existing) {
    const m = String(v).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

function formatNumber(template: string, short: string, seq: number, year: number): string {
  const nnn = String(seq).padStart(3, '0');
  return template.split('{D}').join(short).split('{NNN}').join(nnn).split('{YYYY}').join(String(year));
}

// ---------- วันที่และชีต ----------

// วันนี้ตามเวลาไทย คืนเลขวันที่แบบ Excel และปี พ.ศ.
function thaiToday(nowMs: number): { serial: number; year: number } {
  const d = new Date(nowMs + THAI_OFFSET_MS);
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { serial: (utc - Date.UTC(1899, 11, 30)) / 86400000, year: d.getUTCFullYear() + 543 };
}

// หาชีตตามชื่อ ถ้าไม่เจอตรงตัวให้เทียบโดยไม่สนอีโมจินำหน้า
// อีโมจิบางตัว (เช่น ⚠️) มีอักขระซ่อนที่หายไปได้เมื่อย้ายไฟล์ข้ามระบบ
function findSheet(workbook: ExcelScript.Workbook, name: string): ExcelScript.Worksheet | undefined {
  const exact = workbook.getWorksheet(name);
  if (exact) return exact;
  const want = bareName(name);
  return workbook.getWorksheets().find(ws => bareName(ws.getName()) === want);
}

function bareName(name: string): string {
  return name.replace(/^[^\u0E00-\u0E7FA-Za-z0-9]+/, '').replace(/\s+/g, ' ').trim();
}

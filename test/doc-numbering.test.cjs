/**
 * ทดสอบระบบรันเลขหนังสือ (Office Script ใน doc-numbering/)
 *
 * รันสคริปต์ตัวจริงบน Excel จำลอง (excel-mock.cjs) ที่จัดโครงสร้างชีต
 * เหมือนไฟล์ "ระบบรันเลขหนังสือ AOTGA HKT" ที่ย้ายมาจาก Google Sheets
 */
const path = require('node:path');
const { Sheet, Workbook, loadScript } = require('./excel-mock.cjs');

const dir = path.join(__dirname, '..', 'doc-numbering');
const add = loadScript(path.join(dir, 'เพิ่มหนังสือใหม่.ts'), [
  'main', 'templateFromExample', 'numberPattern', 'nextNumber', 'formatNumber', 'thaiToday', 'leadingCode', 'bareName',
]);
const setup = loadScript(path.join(dir, 'ตั้งค่าระบบครั้งแรก.ts'), ['main', 'fixSerial', 'runs']);

let failures = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`);
  } else {
    console.log(`PASS  ${name}`);
  }
}

// เลขวันที่แบบ Excel จากปี เดือน วัน (ค.ศ.)
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
const ymd = s => new Date(Date.UTC(1899, 11, 30) + s * 86400000).toISOString().slice(0, 10);

// ---------- รูปแบบเลข ----------

check('อ่านรูปแบบบันทึกภายในจากตัวอย่าง', add.templateFromExample('AOTGA/OS-HKT/001/2569'), 'AOTGA/OS-HKT/{NNN}/{YYYY}');
check('อ่านรูปแบบหนังสือเตือน ปีอยู่ท้ายสุด', add.templateFromExample('AOTGA-OS-HKT-OSW-001-2569'), 'AOTGA-OS-HKT-OSW-{NNN}-{YYYY}');
check('อ่านรูปแบบหนังสือรับ', add.templateFromExample('รับเลข 001/2569 (OS)'), 'รับเลข {NNN}/{YYYY} (OS)');
check('ตัวอย่างที่ไม่มี 001 ใช้ไม่ได้', add.templateFromExample('AOTGA/OS-HKT/xxx/2569'), undefined);

const T = 'AOTGA/OS-HKT/{NNN}/{YYYY}';
check('จัดรูปเลข เติมศูนย์ให้ครบสามหลัก', add.formatNumber(T, 'OS', 7, 2569), 'AOTGA/OS-HKT/007/2569');
check('เลขเกิน 999 ไม่ถูกตัด', add.formatNumber(T, 'OS', 1000, 2569), 'AOTGA/OS-HKT/1000/2569');
check('รูปแบบตั้งต้นแทนรหัสแผนกได้ทุกตำแหน่ง',
  add.formatNumber('AOTGA-{D}-HKT-{D}W-{NNN}-{YYYY}', 'LL', 2, 2569), 'AOTGA-LL-HKT-LLW-002-2569');

check('เลขถัดไปนับเฉพาะปีนี้ ข้ามเลขพิมพ์ผิดและปีอื่น',
  add.nextNumber(['AOTGA/OS-HKT/313/2569', 'AOTGA/OS-HKT/500/2568', 'AOTGA/OS-HKT/0862569', 'NaT', '', 42], T.replace('OS', '{D}'), 'OS', 2569),
  314);
check('ทนช่องว่างรอบเลข เช่น "290 /2569"', add.nextNumber(['AOTGA/OS-HKT/290 /2569'], T, 'OS', 2569), 291);
check('ไม่สับสนระหว่าง OS กับ OSS',
  add.nextNumber(['AOTGA/OSS-HKT/050/2569'], T, 'OS', 2569), 1);
check('ปีใหม่เริ่มที่ 001', add.nextNumber(['AOTGA/OS-HKT/313/2569'], T, 'OS', 2570), 1);

check('ตัดรหัสจากตัวเลือกในรายการ', [add.leadingCode('IN - บันทึกภายใน'), add.leadingCode(' ps '), add.leadingCode('PT2')], ['IN', 'PS', 'PT2']);
check('ชื่อชีตเทียบได้แม้อีโมจิต่างกัน', add.bareName('⚠ หนังสือเตือน (PS)'), add.bareName('⚠️ หนังสือเตือน (PS)'));

// ---------- วันที่ ----------

const newYearEve = Date.UTC(2026, 11, 31, 18, 0); // 01:00 วันที่ 1 ม.ค. 2027 เวลาไทย
check('ข้ามปีตามเวลาไทย ไม่ใช่ UTC', add.thaiToday(newYearEve).year, 2570);
check('เลขวันที่ Excel ตามเวลาไทย', ymd(add.thaiToday(newYearEve).serial), '2027-01-01');

check('แก้ปี พ.ศ. ที่ถูกเก็บเป็น ค.ศ.', ymd(setup.fixSerial(serial(2569, 9, 29))), '2026-09-29');
check('แก้ปี พ.ศ. สองหลักที่ถูกตีเป็น 1969', ymd(setup.fixSerial(serial(1969, 1, 3))), '2026-01-03');
check('วันที่ปกติไม่ถูกแตะ', setup.fixSerial(serial(2025, 12, 8)), serial(2025, 12, 8));
check('รวมแถวติดกันเป็นช่วง', setup.runs([4, 5, 6, 9, 11, 12]), [[4, 3], [9, 1], [11, 2]]);

// ---------- ไฟล์จำลอง ----------

const DATA_HEAD = ['ลำดับ', 'วันที่', 'เลขที่หนังสือ', 'เรื่อง', 'ถึง (หน่วยงาน)', 'ผู้บันทึก', 'รหัสผู้บันทึก', 'สถานะ', 'หมายเหตุ'];
const WARN_HEAD = ['ลำดับ', 'วันที่', 'เลขที่หนังสือ', 'เรื่อง', 'ชื่อพนักงาน', 'รหัสพนักงาน', 'ผู้บันทึก', 'รหัสผู้บันทึก', 'หมายเหตุ'];
const RECV_HEAD = ['ลำดับ', 'วันที่รับ', 'เลขรับ', 'เลขหนังสือต้นทาง', 'เรื่อง', 'จาก (หน่วยงาน)', 'วันที่ในหนังสือ', 'ผู้บันทึก', 'รหัสผู้บันทึก', 'หมายเหตุ'];

function dataSheet(name, head, rows) {
  return new Sheet(name, [[name], ['ปี พ.ศ. 2569'], [], head, ...rows]);
}

function homeGrid() {
  const g = [];
  g[1] = ['', 'AOTGA · ระบบรันเลขหนังสือ'];
  g[5] = ['', 'บันทึกภายใน (2569)', 'หนังสือออก-ภายนอก', 'หนังสือรับ-ภายนอก', 'หนังสือเตือน'];
  g[9] = ['', '📝  กรอกข้อมูลหนังสือใหม่'];
  g[10] = ['', 'แผนก', 'PS'];
  g[12] = ['', 'ประเภทหนังสือ', 'IN'];
  g[14] = ['', 'ผู้บันทึก (Code)', 'SB'];
  g[16] = ['', 'เรื่อง', 'ขออนุมัติทดสอบระบบ'];
  g[18] = ['', 'ถึง/จาก', 'ผจก.'];
  g[20] = ['', '▶  กด Ctrl+Enter หรือใช้เมนู'];
  g[22] = ['', '🕐  รายการล่าสุด (10 รายการ)'];
  g[23] = ['', 'วันที่', 'เลขที่หนังสือ', 'เรื่อง', 'ผู้บันทึก'];
  g[24] = ['', serial(2569, 9, 29), 'AOTGA/OS-HKT/313/2569', 'เก่า', 'สุนิศรา บุญยัง'];
  g[35] = ['', 'อัปเดตล่าสุด'];
  return Array.from(g, r => r || []);
}

function makeWorkbook() {
  return new Workbook([
    new Sheet('📊 Master Log', [
      ['📊 Master Log — เลขหนังสือทั้งหมดทุกแผนก'],
      ['ลำดับ', 'วันที่', 'เลขที่หนังสือ', 'ประเภท', 'แผนก', 'เรื่อง', 'ถึง/จาก', 'ผู้บันทึก', 'รหัสผู้บันทึก', 'หมายเหตุ'],
      [1, '', 'NaT', 'บันทึกภายใน', 'การโดยสาร 2569', 'NaT', '', 'IMPORT', '-'],
      [2, serial(2569, 9, 29), 'AOTGA/OS-HKT/313/2569', 'บันทึกภายใน', 'การโดยสาร', 'เก่า', '', 'สุนิศรา บุญยัง', 'SB'],
    ]),
    new Sheet('🏠 หน้าหลัก', homeGrid()),
    new Sheet('👥 แอดมิน', [
      ['ลำดับ', 'รหัสพนักงาน', 'รหัสย่อ (Code)', 'คำนำหน้า', 'ชื่อ (TH)', 'นามสกุล (TH)', 'Title', 'Name', 'Surname', 'แผนก', 'ตำแหน่ง', 'สถานะ'],
      [1, 2202011, 'SB', 'นางสาว', 'สุนิศรา', 'บุญยัง', '', '', '', 'การโดยสาร (PS)', '', 'Active'],
      [2, 2506762, 'KP2', 'นางสาว', 'กาญจนาพร', 'เภรินทวงค์', '', '', '', 'การโดยสาร (PS)', '', 'Active'],
      [3, 1, 'OLD', 'นาย', 'ลาออก', 'แล้ว', '', '', '', '', '', 'Inactive'],
    ]),
    new Sheet('⚙️ ตั้งค่า', [
      ['🔧 การตั้งค่าระบบ'],
      ['ปีงบประมาณปัจจุบัน (พ.ศ.)', 2569],
      ['รหัสองค์กร', 'AOTGA'],
      ['รหัสสนามบิน', 'HKT'],
      ['📌 รูปแบบเลขที่หนังสือ', 'ตัวอย่าง'],
      ['บันทึกภายใน (PS)', 'AOTGA/OS-HKT/001/2569'],
      ['บันทึกภายใน (SS)', 'AOTGA/OSS-HKT/001/2569'],
      ['หนังสือภายนอก (PS)', 'AOTGA/HKT-OS/001/2569'],
      ['หนังสือเตือน (PS)', 'AOTGA-OS-HKT-OSW-001-2569'],
    ]),
    dataSheet('📥 บันทึกภายใน (PS)', DATA_HEAD, [
      [0, '', 'NaT', 'NaT', '', 'นำเข้าจากระบบเดิม', 'IMPORT', 'ปกติ'],
      [0, '', 'NaT', 'NaT', '', 'นำเข้าจากระบบเดิม', 'IMPORT', 'ปกติ'],
      [312, serial(2569, 9, 27), 'AOTGA/OS-HKT/312/2569', 'ขออนุมัติเปิดอัตรา', '', 'สุนิศรา บุญยัง', 'SB', 'ปกติ'],
      [313, serial(2569, 9, 29), 'AOTGA/OS-HKT/313/2569', 'ขออนุมัติใช้บัตรเครดิต', '', 'สุนิศรา บุญยัง', 'SB', 'ปกติ'],
    ]),
    dataSheet('📥 บันทึกภายใน (PS) 2568', DATA_HEAD, [
      [1, serial(2025, 12, 8), 'AOTGA/OS-HKT/291/2568', 'ปีก่อน', '', 'นำเข้าจากระบบเดิม', 'IMPORT', 'ปกติ'],
    ]),
    dataSheet('📤 หนังสือออก-ภายนอก (PS)', DATA_HEAD, [
      [2, serial(1969, 1, 3), 'AOTGA/HKT-OS/002/2569', 'ขออนุญาตทำการบิน', '', 'นำเข้าจากระบบเดิม', 'IMPORT', 'ปกติ'],
      [85, serial(2569, 9, 24), 'AOTGA/HKT-OS/085/2569', 'ยกเลิกทำการบิน', 'ท่าอากาศยานภูเก็ต', 'ปิ่นมนัส ดัชถุยาวัตร', 'PD', 'ปกติ'],
      [86, serial(2569, 9, 25), 'AOTGA/HKT-OS/085/2569', 'ออกเลขซ้ำโดยไม่ตั้งใจ', '', '', '', 'ปกติ'],
    ]),
    dataSheet('⚠ หนังสือเตือน (PS)', WARN_HEAD, [
      [59, serial(2569, 9, 23), 'AOTGA-OS-HKT-OSW-059-2569', 'หนังสือเตือนภายใน', 'นางสาวสาริศา อุตตะมะ', 2607260, 'ปราณจรีย์ ปัจฉิมทึก', 'PP'],
    ]),
    dataSheet('📨 หนังสือรับ-ภายนอก (PS)', RECV_HEAD, [
      [6, serial(2569, 8, 24), 'รับเลข 006/2569 (OS)', '', 'อบรม', '', serial(2569, 8, 18), 'สุนิศรา บุญยัง', 'SB'],
    ]),
    dataSheet('📥 บันทึกภายใน (BS)', DATA_HEAD, []),
  ]);
}

const NOW = Date.UTC(2026, 8, 30, 3, 0); // 30 ก.ย. 2569 10:00 เวลาไทย
const realNow = Date.now;
Date.now = () => NOW;

function setForm(wb, values) {
  const home = wb.getWorksheet('🏠 หน้าหลัก');
  const labels = home.getRange('B1:B60').getValues().map(r => String(r[0]));
  for (const [label, v] of Object.entries(values)) {
    const row = labels.findIndex(l => l.startsWith(label));
    if (row < 0) throw new Error(`ไม่พบป้าย ${label}`);
    home.getCell(row, 2).setValue(v);
  }
}
const lastRow = sheet => { const d = sheet.dump(); return d[d.length - 1]; };
const formValue = (wb, label) => {
  const home = wb.getWorksheet('🏠 หน้าหลัก');
  const rows = home.getRange('B1:C60').getValues();
  const r = rows.find(x => String(x[0]).startsWith(label));
  return r && r[1];
};

// ---------- ออกเลขบนไฟล์ที่ยังไม่ได้ตั้งค่า (เหมือนเพิ่งย้ายมา) ----------
{
  const wb = makeWorkbook();
  const got = add.main(wb);
  check('ออกเลขถัดจากเลขล่าสุดของปี', got, 'AOTGA/OS-HKT/314/2569');
  const row = lastRow(wb.getWorksheet('📥 บันทึกภายใน (PS)'));
  check('เขียนแถวลงชีตของแผนกและประเภท',
    row, [314, serial(2026, 9, 30), 'AOTGA/OS-HKT/314/2569', 'ขออนุมัติทดสอบระบบ', 'ผจก.', 'สุนิศรา บุญยัง', 'SB', 'ปกติ', '']);
  check('วันที่เป็นวันที่จริงของ Excel ตามเวลาไทย', ymd(row[1]), '2026-09-30');
  check('ต่อท้าย Master Log',
    lastRow(wb.getWorksheet('📊 Master Log')),
    [3, serial(2026, 9, 30), 'AOTGA/OS-HKT/314/2569', 'บันทึกภายใน', 'การโดยสาร', 'ขออนุมัติทดสอบระบบ', 'ผจก.', 'สุนิศรา บุญยัง', 'SB', '']);
  check('ล้างช่องเรื่องหลังบันทึก แต่คงแผนกและผู้บันทึกไว้',
    [formValue(wb, 'เรื่อง'), formValue(wb, 'แผนก'), formValue(wb, 'ผู้บันทึก')], ['', 'PS', 'SB']);
  const home = wb.getWorksheet('🏠 หน้าหลัก');
  check('รายการล่าสุดขึ้นเลขใหม่เป็นแถวแรก', home.getRange('C25:C26').getValues(), [['AOTGA/OS-HKT/314/2569'], ['AOTGA/OS-HKT/313/2569']]);

  setForm(wb, { 'เรื่อง': 'เรื่องที่สอง' });
  check('กดครั้งถัดไปได้เลขถัดไป', add.main(wb), 'AOTGA/OS-HKT/315/2569');

  setForm(wb, { 'เรื่อง': '' });
  check('ไม่มีเรื่องไม่ออกเลข', add.main(wb), '❌ กรอกเรื่องก่อน');
  setForm(wb, { 'เรื่อง': 'x', 'ผู้บันทึก': 'OLD' });
  check('ผู้บันทึกที่ไม่ Active ไม่ออกเลข', add.main(wb).startsWith('❌ ไม่พบรหัสผู้บันทึก'), true);
  setForm(wb, { 'ผู้บันทึก': 'SB', 'ประเภทหนังสือ': '' });
  check('ไม่เลือกประเภทไม่ออกเลข', add.main(wb).startsWith('❌ เลือกประเภท'), true);
  check('ความผิดพลาดไม่เขียนแถวเพิ่ม', lastRow(wb.getWorksheet('📥 บันทึกภายใน (PS)'))[2], 'AOTGA/OS-HKT/315/2569');
}

// ---------- ตั้งค่าครั้งแรก ----------
{
  const wb = makeWorkbook();
  const report = setup.main(wb);
  const home = wb.getWorksheet('🏠 หน้าหลัก');
  const labels = home.getRange('B1:B40').getValues().map(r => r[0]).filter(v => v !== '');
  check('เพิ่มช่องใหม่ใต้ถึง/จาก โดยรายการล่าสุดยังอยู่', labels.slice(5, 13), [
    'ผู้บันทึก (Code)', 'เรื่อง', 'ถึง/จาก', 'รหัสพนักงาน / เลขหนังสือต้นทาง', 'วันที่ในหนังสือ',
    'หมายเหตุ / ลิงก์ไฟล์', '✅ เลขที่ได้', '▶  กดปุ่ม "เพิ่มหนังสือใหม่" (หรือ Automate → เพิ่มหนังสือใหม่ → Run) เพื่อออกเลข',
  ]);
  check('รายการให้เลือกผู้บันทึกดึงจากชีตแอดมิน',
    home.validations['14,2'], { list: { inCellDropDown: true, source: "='👥 แอดมิน'!$C$2:$C$300" } });
  check('ลบแถว NaT ในชีตข้อมูล', wb.getWorksheet('📥 บันทึกภายใน (PS)').dump().slice(4).map(r => r[2]),
    ['AOTGA/OS-HKT/312/2569', 'AOTGA/OS-HKT/313/2569']);
  check('ลบแถว NaT ใน Master Log', wb.getWorksheet('📊 Master Log').dump().slice(2).map(r => r[2]), ['AOTGA/OS-HKT/313/2569']);
  check('แก้ปีวันที่ในชีตข้อมูล', ymd(wb.getWorksheet('📥 บันทึกภายใน (PS)').dump()[5][1]), '2026-09-29');
  check('แก้ปี 1969 ในหนังสือออก', ymd(wb.getWorksheet('📤 หนังสือออก-ภายนอก (PS)').dump()[4][1]), '2026-01-03');
  check('แก้ปีวันที่ในหนังสือของหนังสือรับ', ymd(wb.getWorksheet('📨 หนังสือรับ-ภายนอก (PS)').dump()[4][6]), '2026-08-18');
  check('วันที่ปีก่อนที่ถูกต้องอยู่แล้วไม่ถูกแตะ', ymd(wb.getWorksheet('📥 บันทึกภายใน (PS) 2568').dump()[4][1]), '2025-12-08');
  check('ตั้งรูปแบบวันที่ไทย', wb.getWorksheet('📥 บันทึกภายใน (PS)').getCell(4, 1).getNumberFormat(), '[$-41E]d mmm bbbb');
  check('ปีในชีตตั้งค่าเป็นสูตร', wb.getWorksheet('⚙️ ตั้งค่า').getRange('B2').getFormulas(), [['=YEAR(TODAY())+543']]);
  check('เติมรูปแบบหนังสือรับที่ขาด', wb.getWorksheet('⚙️ ตั้งค่า').dump().some(r => r[0] === 'หนังสือรับ-ภายนอก (SS)'), true);
  check('รายงานเลขซ้ำ', report.includes('เลขซ้ำ AOTGA/HKT-OS/085/2569 (2 แถว)'), true);

  const again = setup.main(wb);
  check('รันซ้ำไม่เพิ่มช่องหรือแก้ข้อมูลซ้ำ',
    [home.getRange('B1:B60').getValues().filter(r => r[0] === '✅ เลขที่ได้').length, again.includes('ลบแถว'), again.includes('แก้ปี')],
    [1, false, false]);

  // ออกเลขหลังตั้งค่า — ช่องใหม่และตัวเลือกแบบมีคำอธิบายต้องใช้ได้
  setForm(wb, { 'แผนก': 'PS - การโดยสาร', 'ประเภทหนังสือ': 'WARN - หนังสือเตือน', 'ผู้บันทึก': 'KP2',
    'เรื่อง': 'หนังสือเตือนภายใน', 'ถึง/จาก': 'นายทดสอบ ระบบ', 'รหัสพนักงาน': 2600001 });
  check('หนังสือเตือนใช้รูปแบบของตัวเอง', add.main(wb), 'AOTGA-OS-HKT-OSW-060-2569');
  check('หนังสือเตือนเก็บชื่อและรหัสพนักงานในคอลัมน์ที่ถูกต้อง',
    lastRow(wb.getWorksheet('⚠ หนังสือเตือน (PS)')).slice(2, 8),
    ['AOTGA-OS-HKT-OSW-060-2569', 'หนังสือเตือนภายใน', 'นายทดสอบ ระบบ', 2600001, 'กาญจนาพร เภรินทวงค์', 'KP2']);
  check('แสดงเลขที่ได้ในหน้าหลัก', formValue(wb, '✅ เลขที่ได้'), 'AOTGA-OS-HKT-OSW-060-2569');
  check('ล้างรหัสพนักงานหลังบันทึก', formValue(wb, 'รหัสพนักงาน'), '');

  setForm(wb, { 'ประเภทหนังสือ': 'RECV - หนังสือรับ-ภายนอก', 'เรื่อง': 'ขอเชิญประชุม', 'ถึง/จาก': 'ทภก.',
    'รหัสพนักงาน': 'ทภก. 400/2569', 'วันที่ในหนังสือ': serial(2026, 9, 25), 'หมายเหตุ': 'https://example.com/f' });
  check('หนังสือรับใช้รูปแบบเลขรับ', add.main(wb), 'รับเลข 007/2569 (OS)');
  check('หนังสือรับเก็บเลขต้นทางและวันที่ในหนังสือ',
    lastRow(wb.getWorksheet('📨 หนังสือรับ-ภายนอก (PS)')).slice(2),
    ['รับเลข 007/2569 (OS)', 'ทภก. 400/2569', 'ขอเชิญประชุม', 'ทภก.', serial(2026, 9, 25), 'กาญจนาพร เภรินทวงค์', 'KP2', 'https://example.com/f']);

  setForm(wb, { 'แผนก': 'BS - ติดตามสัมภาระ', 'ประเภทหนังสือ': 'IN - บันทึกภายใน', 'เรื่อง': 'แผนกใหม่' });
  check('ชีตว่างเริ่มที่ 001 และใช้รูปแบบตั้งต้นเมื่อไม่มีตัวอย่าง', add.main(wb), 'AOTGA/LL-HKT/001/2569');
}

// ---------- ขึ้นปีใหม่ ----------
{
  const wb = makeWorkbook();
  Date.now = () => Date.UTC(2026, 11, 31, 17, 30); // 00:30 วันที่ 1 ม.ค. 2570 เวลาไทย
  check('ขึ้นปีใหม่แล้วเลขเริ่ม 001 ในชีตเดิม', add.main(wb), 'AOTGA/OS-HKT/001/2570');
  Date.now = () => NOW;
}

// ---------- กดพร้อมกันสองคน ----------
{
  // จำลองอีกคนเขียนทับแถวที่เราเพิ่งเขียน ด้วยเลขเดียวกันแต่เรื่องของเขา
  const wb = makeWorkbook();
  const sheet = wb.getWorksheet('📥 บันทึกภายใน (PS)');
  const original = sheet.getRangeByIndexes.bind(sheet);
  let raced = false;
  sheet.getRangeByIndexes = (r, c, nr, nc) => {
    const range = original(r, c, nr, nc);
    if (!raced && nr === 1 && nc === DATA_HEAD.length) {
      const set = range.setValues.bind(range);
      range.setValues = v => {
        set(v);
        raced = true;
        set([[314, v[0][1], 'AOTGA/OS-HKT/314/2569', 'ของอีกคน', '', 'กาญจนาพร เภรินทวงค์', 'KP2', 'ปกติ', '']]);
      };
    }
    return range;
  };
  check('ถูกเขียนทับแล้วขยับไปเลขถัดไปในแถวใหม่', add.main(wb), 'AOTGA/OS-HKT/315/2569');
  check('ทั้งสองรายการอยู่ครบ', sheet.dump().slice(-2).map(r => [r[2], r[3]]),
    [['AOTGA/OS-HKT/314/2569', 'ของอีกคน'], ['AOTGA/OS-HKT/315/2569', 'ขออนุมัติทดสอบระบบ']]);
}

Date.now = realNow;

if (failures) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall passed');

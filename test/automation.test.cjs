/**
 * ทดสอบงานอัตโนมัติตามเวลา
 *
 * ทดสอบเฉพาะตรรกะล้วนที่ไม่แตะบริการของ Apps Script คือการตัดสินว่า
 * วันนี้ถึงเวลาเปิดหรือปิดวงรอบหรือยัง และการแปลงผลตรวจนับเป็นข้อความ
 * กับตารางรายงาน ส่วนที่เหลือเป็นการเรียก SpreadsheetApp ตรง ๆ ซึ่งต้อง
 * ทดสอบบนชีตจริง
 *
 * โหลดด้วย eval ในโมดูล CommonJS ด้วยเหตุผลเดียวกับ import.test.cjs คือ
 * .gs ประกาศทุกอย่างไว้ที่ global scope ซึ่งอยู่ได้เฉพาะใน sloppy mode
 */
const fs = require('node:fs');
const nodePath = require('node:path');
const dir = nodePath.join(__dirname, '..', 'apps-script');
const src = ['Schema.gs', 'Domain.gs', 'Automation.gs']
  .map(f => fs.readFileSync(nodePath.join(dir, f), 'utf8')).join('\n');

let props = {};
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) })
};
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ toast() {} }) };
eval(src);

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

// ---- การอ่านค่าตั้งค่า ----
props = {};
check('ค่าเริ่มต้นเมื่อยังไม่ตั้งอะไร', [autoProp_('CLOSE_DAY'), autoHour_('DIGEST_HOUR')], ['0', 17]);
props = { AUTOMATION_DIGEST_HOUR: '8', AUTOMATION_AUTO_CLOSE: 'FALSE' };
check('อ่านค่าที่ตั้งไว้', [autoHour_('DIGEST_HOUR'), autoFlag_('AUTO_CLOSE')], [8, false]);
props = { AUTOMATION_DIGEST_HOUR: '99' };
check('ชั่วโมงนอกช่วง 0–23 ต้องถอยไปใช้ค่าเริ่มต้น', autoHour_('DIGEST_HOUR'), 17);
props = { AUTOMATION_CLOSE_DAY: '   ' };
check('ค่าว่างมีแต่ช่องว่างถือว่ายังไม่ตั้ง', autoProp_('CLOSE_DAY'), '0');
props = {};

// ---- ตรรกะวันที่ ----
check('ตัดงวดจากวันที่', periodOfKey_('2026-09-20'), '2026-09');
check('จำนวนวันเดือนกุมภาพันธ์ปีอธิกสุรทิน', [daysInMonth_(2024, 2), daysInMonth_(2026, 2)], [29, 28]);
check('ปี 2000 เป็นปีอธิกสุรทิน ปี 1900 ไม่ใช่', [isLeapYear_(2000), isLeapYear_(1900)], [true, false]);

// ค่าเริ่มต้น '0' หมายถึงวันสุดท้ายของเดือน ซึ่งต่างกันไปในแต่ละเดือน
check('วันสุดท้ายของเดือน 30 วัน', [isCloseDay_('2026-09-30', '0'), isCloseDay_('2026-09-29', '0')], [true, false]);
check('วันสุดท้ายของเดือน 31 วัน', isCloseDay_('2026-10-31', '0'), true);
check('วันสุดท้ายของเดือนกุมภาพันธ์', [isCloseDay_('2026-02-28', '0'), isCloseDay_('2024-02-29', '0')], [true, true]);
check('ตั้งวันปิดเองได้', [isCloseDay_('2026-09-25', '25'), isCloseDay_('2026-09-26', '25')], [true, false]);
// ถ้าไม่ถอยให้เป็นวันสุดท้าย เดือนกุมภาพันธ์จะไม่มีวันปิดเลยและวงรอบจะค้างทั้งเดือน
check('ตั้งวันที่ 31 ในเดือนที่ไม่มีวันนั้น ต้องปิดวันสุดท้ายแทน',
  [isCloseDay_('2026-02-28', '31'), isCloseDay_('2026-04-30', '31')], [true, true]);
check('วันที่ผิดรูปแบบไม่ถือว่าถึงกำหนด', isCloseDay_('ไม่ใช่วันที่', '0'), false);

// ---- การค้นวงรอบ ----
const rounds = [
  { round_id: 'r-aug', period: '2026-08', status: 'closed' },
  { round_id: 'r-sep', period: '2026-09', status: 'open' }
];
check('หาวงรอบที่เปิดอยู่ของงวดนี้', findOpenRound_(rounds, '2026-09').round_id, 'r-sep');
check('งวดที่ปิดไปแล้วไม่ถือว่าเปิดอยู่', findOpenRound_(rounds, '2026-08'), null);
check('งวดที่ยังไม่เคยมีวงรอบ', findOpenRound_(rounds, '2026-10'), null);
check('มีวงรอบของงวดนี้แล้วแม้จะปิดไปแล้ว',
  [hasRoundForPeriod_(rounds, '2026-08'), hasRoundForPeriod_(rounds, '2026-10')], [true, false]);

// ---- วงรอบที่ถึงกำหนดปิด ----
const ids = (list) => list.map(r => r.round_id);
check('ยังไม่ถึงวันปิด ไม่ปิดวงรอบของงวดนี้', ids(roundsDueToClose_(rounds, '2026-09-15', '0')), []);
check('ถึงวันสุดท้ายของเดือนจึงปิด', ids(roundsDueToClose_(rounds, '2026-09-30', '0')), ['r-sep']);

// วงรอบที่ค้างจากงวดก่อนต้องถูกเก็บกวาดทันที ไม่ต้องรอถึงวันปิดของเดือนนั้น
// มิฉะนั้นรอบที่รันไม่สำเร็จหนึ่งครั้งจะทำให้วงรอบค้างเปิดข้ามเดือนไปเรื่อย ๆ
const stale = [{ round_id: 'r-jul', period: '2026-07', status: 'open' }].concat(rounds);
check('วงรอบค้างจากงวดก่อนต้องปิดทันทีที่เจอ',
  ids(roundsDueToClose_(stale, '2026-09-15', '0')), ['r-jul']);
check('วันปิดของงวดนี้ ปิดทั้งของค้างและของงวดนี้',
  ids(roundsDueToClose_(stale, '2026-09-30', '0')), ['r-jul', 'r-sep']);

// ---- ข้อความสรุปและตารางรายงาน ----
const assets = [
  { asset_code: '10020012', seq: '1', name: 'Notebook HP', location: 'DOM LL 02', qty: '1', unit: 'เครื่อง', item_type: 'asset', status: 'สมบูรณ์', tag_condition: 'สมบูรณ์', active: 'TRUE' },
  { asset_code: '10013338', seq: '2', name: 'ถังดับเพลิง', location: 'DOM LL 02', qty: '1', unit: 'ถัง', item_type: 'asset', status: 'สมบูรณ์', tag_condition: 'สมบูรณ์', active: 'TRUE' },
  { asset_code: '10014136', seq: '3', name: 'ป้ายทางออกหนีไฟ', location: 'ห้อง ADI301', qty: '1', unit: 'แผ่น', item_type: 'asset', status: 'สมบูรณ์', tag_condition: 'สมบูรณ์', active: 'TRUE' }
];
const tags = [
  { tag_id: 'E2801160000010020012', asset_code: '10020012', active: 'TRUE' },
  { tag_id: 'E2801160000010014136', asset_code: '10014136', active: 'TRUE' }
];
const round = { round_id: 'r-sep', name: 'วงรอบประจำเดือน กันยายน 2569', period: '2026-09', scope_type: 'all' };
const report = reconcile_(round, assets, tags, [
  { tag_id: 'E2801160000010020012', status: 'ชำรุด', tag_condition: 'สมบูรณ์', scanned_at: '2026-09-20T09:00:00', scanned_location: 'DOM LL 02' },
  { tag_id: 'E28011600000FFFFFFFF', scanned_at: '2026-09-20T09:05:00' }
]);
report.generated_at = '2026-09-20T09:10:00';

check('สรุปตรงกับผลการตรวจนับ',
  [report.summary.found, report.summary.missing, report.summary.unknown], [1, 2, 1]);

const lines = digestLines_(report);
check('บรรทัดแรกบอกความคืบหน้า', lines[0], 'ตรวจแล้ว 1 จาก 3 รายการ (33%)');
check('บอกจำนวนที่ยังไม่พบ', lines[1], 'ยังไม่พบ 2 รายการ');
check('บอกแท็กที่ยังไม่ผูกทะเบียน', lines[2], 'แท็กที่ยังไม่ผูกกับทะเบียน 1 รายการ');
// เรียงห้องที่เหลือมากที่สุดขึ้นก่อน เพื่อให้รู้ว่าพรุ่งนี้ควรเริ่มตรวจที่ไหน
check('ไล่ห้องที่เหลือมากที่สุดก่อน', lines[3], 'เหลือมากที่สุด: DOM LL 02 1 · ห้อง ADI301 1');

const noMisplaced = digestLines_(report).filter(l => l.indexOf('ผิดสถานที่') >= 0);
check('ไม่มีของผิดที่ก็ไม่ต้องขึ้นบรรทัดนั้น', noMisplaced, []);

const rows = snapshotRows_(report);
const widths = [...new Set(rows.map(r => r.length))];
// setValues ปฏิเสธตารางที่แต่ละแถวกว้างไม่เท่ากัน จึงต้องเติมให้เท่ากันก่อนเสมอ
check('ทุกแถวกว้างเท่ากัน', widths, [11]);
check('หัวรายงานมีชื่อวงรอบ', rows[0][0], 'รายงานการตรวจนับ วงรอบประจำเดือน กันยายน 2569');
check('บันทึกเวลาที่สร้างรายงาน', rows[1][1], '2026-09-20T09:10:00');
check('หัวตารางรายการอยู่แถวที่ 14', rows[13][0], 'ลำดับที่');

const body = rows.slice(14);
check('มีครบทั้งที่พบ ไม่พบ และแท็กไม่รู้จัก', body.length, 4);
check('รายการที่พบใช้สถานะจากการสแกน ไม่ใช่จากทะเบียน',
  [body[0][2], body[0][6], body[0][7]], ['10020012', 'พบ', 'ชำรุด']);
check('รายการที่ไม่พบคงสถานะเดิมจากทะเบียน',
  [body[1][6], body[1][7], body[1][9]], ['ไม่พบ', 'สมบูรณ์', '']);
check('แท็กที่ไม่รู้จักแสดงรหัสแท็กไว้ในช่องรหัส',
  [body[3][2], body[3][6]], ['E28011600000FFFFFFFF', 'ไม่รู้จัก']);

console.log(failures ? `\nไม่ผ่าน ${failures} กรณี` : '\nทุกกรณีผ่าน');
process.exit(failures ? 1 : 0);

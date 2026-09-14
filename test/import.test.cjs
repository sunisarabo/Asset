/**
 * ทดสอบตัวนำเข้าทะเบียนจากชีตรายงานเดิม
 *
 * ไฟล์ .gs เป็น JavaScript ธรรมดาที่ทำงานในขอบเขต global ของ Apps Script
 * จึงโหลดด้วย eval ในโมดูล CommonJS ซึ่งเป็น sloppy mode ทำให้ var และ
 * function declaration ถูกประกาศออกมาให้เรียกใช้ต่อได้ตามปกติ
 * (ถ้าเปลี่ยนไฟล์นี้เป็น ESM จะเรียกฟังก์ชันเหล่านั้นไม่ได้ เพราะ strict mode)
 */
const fs = require('node:fs');
const nodePath = require('node:path');
const dir = nodePath.join(__dirname, '..', 'apps-script');
const src = ['Schema.gs', 'Domain.gs', 'Import.gs']
  .map(f => fs.readFileSync(nodePath.join(dir, f), 'utf8')).join('\n');

// ตัดส่วนที่ต้องพึ่ง SpreadsheetApp ออก เหลือเฉพาะตรรกะล้วน
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ toast() {} }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Session = { getActiveUser: () => ({ getEmail: () => 'test' }) };
eval(src);

// โครงสร้างหัวตารางเหมือนชีตจริง: เซลล์ผสานมีค่าเฉพาะช่องซ้ายบน
const assetTable = [
  ['ตารางรายงานการตรวจนับทรัพย์สิน (Asset) แผนก การโดยสาร ท่าอากาศยานภูเก็ต  วงรอบประจำเดือน กันยายน','','','','','','','','','','','','','','','',''],
  ['ลำดับที่','ชื่อรายการทรัพย์สิน ','รหัสทรัพย์สิน','สถานที่','จำนวนที่ครอบครอง','','จำนวนทรัพย์สินแบ่งแยกตามสถานะ','','','','','','','ความสมบูรณ์ของ TAG','','','หมายเหตุ'],
  ['','','','','จำนวน','หน่วย','สมบูรณ์','ชำรุด','สูญหาย','เตรียมโอนย้าย','เตรียมจำหน่าย','ส่งซ่อม','อื่นๆ','สมบูรณ์','ชำรุด','สูญหาย',''],
  ['1','Notebook HP-Amonsak Rungruangsri-HKTPS-N0044','10020012','DOM LL 02','1','เครื่อง','1','','','','','','','1','','',''],
  ['2','ถังดับเพลิง ขนาด 10 ปอนด์','10013338','DOM LL 02','1','ถัง','1','','','','','','','1','','',''],
  ['68','ป้ายทางออกหนีไฟ','10014136','ห้อง ADI301','1','แผ่น','1','','','','','','','','1','','PA'],
];

const inventoryTable = [
  ['ตารางรายงานการตรวจนับสินค้าคงคลัง (Inventory) แผนก การโดยสาร ท่าอากาศยานภูเก็ต  วงรอบประจำเดือน กันยายน','','','','','','','','','','',''],
  ['ลำดับที่','ชื่อรายการสินค้าคงคลัง','รหัสสินค้า','สถานที่','จำนวนที่ครอบครอง','จำนวนทรัพย์สินแบ่งแยกตามสถานะ','','','','','รวมจำนวนการตรวจนับ','หมายเหตุ'],
  ['','','','','','สมบูรณ์','ชำรุด','สูญหาย','เตรียมโอนย้าย','อื่นๆ ','',''],
  ['19','ชั้นวางรองเท้า','10020146','ห้อง IT101','1','','1','','','','1',''],
  ['72','Router 4G TP-LINK','10022916','ห้อง IT213','1','','','','1','','1','รอโอนย้ายให้ DOM LL02'],
  ['1','Monitor Acer 27 นิ้ว','10021730','DOM LL 02','1','1','','','','','1',''],
];

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) console.log('   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
  return ok;
}

let pass = true;

// --- ตาราง Asset ---
let starts = findTableStarts_(assetTable);
pass &= check('asset: พบหัวตาราง 1 ชุด', starts, [1]);
let rows = parseTable_(assetTable, 1);
pass &= check('asset: อ่านได้ 3 แถว', rows.length, 3);
pass &= check('asset: แถวแรกถูกต้อง', rows[0], {
  asset_code: '10020012', item_type: 'asset', seq: '1',
  name: 'Notebook HP-Amonsak Rungruangsri-HKTPS-N0044', location: 'DOM LL 02',
  qty: '1', unit: 'เครื่อง', status: 'สมบูรณ์', tag_condition: 'สมบูรณ์',
  note: '', active: 'TRUE'
});
pass &= check('asset: TAG ชำรุด + หมายเหตุ', 
  [rows[2].tag_condition, rows[2].note, rows[2].unit], ['ชำรุด', 'PA', 'แผ่น']);

// --- ตาราง Inventory ---
rows = parseTable_(inventoryTable, 1);
pass &= check('inventory: อ่านได้ 3 แถว', rows.length, 3);
pass &= check('inventory: จับประเภทเป็นสินค้าคงคลัง', rows[0].item_type, 'inventory');
pass &= check('inventory: สถานะชำรุด', rows[0].status, 'ชำรุด');
pass &= check('inventory: ไม่มีคอลัมน์ TAG จึงเว้นว่าง', rows[0].tag_condition, '');
pass &= check('inventory: เตรียมโอนย้าย + หมายเหตุ',
  [rows[1].status, rows[1].note], ['เตรียมโอนย้าย', 'รอโอนย้ายให้ DOM LL02']);
pass &= check('inventory: ไม่มีหน่วย', rows[1].unit, '');
pass &= check('inventory: จำนวนที่ครอบครอง', rows[2].qty, '1');

// --- normalizeTag_ ---
pass &= check('tag: NFC มีโคลอน', normalizeTag_('04:1a:2b:3c'), '041A2B3C');
pass &= check('tag: UHF มีขีด', normalizeTag_('E280-1160-6000'), 'E28011606000');
pass &= check('tag: ตัวพิมพ์เล็ก', normalizeTag_('e28011606000'), 'E28011606000');
pass &= check('tag: รหัสที่ไม่ใช่ hex คงขีดไว้', normalizeTag_('IT303-304'), 'IT303-304');
pass &= check('code: รหัสมีช่องว่าง', normalizeCode_(' 10020012 '), '10020012');

console.log(pass ? '\nทุกกรณีผ่าน' : '\nมีกรณีที่ไม่ผ่าน');
process.exit(pass ? 0 : 1);

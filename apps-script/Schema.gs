/**
 * Schema.gs — นิยามโครงสร้างชีตที่ใช้เป็นฐานข้อมูล
 *
 * โครงสร้างนี้ออกแบบให้ตรงกับ "ตารางรายงานการตรวจนับทรัพย์สิน/สินค้าคงคลัง
 * แผนกการโดยสาร ท่าอากาศยานภูเก็ต" ที่ใช้งานอยู่จริง เพื่อให้ข้อมูลที่สแกน
 * ออกรายงานในรูปแบบเดิมได้ทันทีโดยไม่ต้องแปลงมือ
 */

var SHEETS = {
  ASSETS: 'Assets',
  TAGS: 'Tags',
  ROUNDS: 'Rounds',
  SCANS: 'Scans',
  LOG: 'Log'
};

/** สถานะทรัพย์สิน ตรงกับหัวตาราง "จำนวนทรัพย์สินแบ่งแยกตามสถานะ" */
var STATUS = {
  COMPLETE: 'สมบูรณ์',
  DAMAGED: 'ชำรุด',
  LOST: 'สูญหาย',
  TO_TRANSFER: 'เตรียมโอนย้าย',
  TO_DISPOSE: 'เตรียมจำหน่าย',
  REPAIR: 'ส่งซ่อม',
  OTHER: 'อื่นๆ'
};
var STATUS_ORDER = [
  STATUS.COMPLETE, STATUS.DAMAGED, STATUS.LOST,
  STATUS.TO_TRANSFER, STATUS.TO_DISPOSE, STATUS.REPAIR, STATUS.OTHER
];

/** ความสมบูรณ์ของ TAG ตรงกับหัวตาราง "ความสมบูรณ์ของ TAG" */
var TAG_CONDITION = {
  COMPLETE: 'สมบูรณ์',
  DAMAGED: 'ชำรุด',
  LOST: 'สูญหาย'
};
var TAG_CONDITION_ORDER = [
  TAG_CONDITION.COMPLETE, TAG_CONDITION.DAMAGED, TAG_CONDITION.LOST
];

/** ประเภทรายการ — ชีตต้นทางแยกเป็นสองตาราง จึงเก็บไว้เป็นคอลัมน์เดียว */
var ITEM_TYPE = {
  ASSET: 'asset',        // ทรัพย์สิน
  INVENTORY: 'inventory' // สินค้าคงคลัง
};

var COLUMNS = {
  // ทะเบียนรวมของทั้งสองตาราง แยกด้วยคอลัมน์ item_type
  Assets: [
    'asset_code',     // รหัสทรัพย์สิน / รหัสสินค้า (unique key)
    'item_type',      // asset | inventory
    'seq',            // ลำดับที่เดิมในตาราง ใช้เรียงตอนออกรายงาน
    'name',           // ชื่อรายการ
    'location',       // สถานที่
    'qty',            // จำนวนที่ครอบครอง
    'unit',           // หน่วย เช่น เครื่อง ตัว ชุด ใบ
    'status',         // สถานะล่าสุดตามทะเบียน
    'tag_condition',  // ความสมบูรณ์ของ TAG ล่าสุด
    'note',           // หมายเหตุ
    'active',         // TRUE/FALSE — FALSE เมื่อจำหน่ายออกแล้ว
    'updated_at',
    'updated_by'
  ],

  // แผนที่ระหว่างแท็ก RFID กับรายการทรัพย์สิน หนึ่งรายการผูกได้หลายแท็ก
  Tags: [
    'tag_id',      // EPC (UHF) หรือ UID (NFC) ที่ normalize แล้ว
    'asset_code',
    'tag_type',    // uhf | nfc | barcode | manual
    'active',      // TRUE/FALSE — FALSE เมื่อเปลี่ยนแท็กใหม่
    'bound_at',
    'bound_by'
  ],

  // วงรอบการตรวจนับ ปกติเปิดเดือนละหนึ่งรอบ
  Rounds: [
    'round_id',
    'name',        // เช่น "วงรอบประจำเดือน กันยายน 2568"
    'period',      // yyyy-MM ใช้อ้างอิงวงรอบรายเดือน
    'scope_type',  // all | location | item_type
    'scope_value',
    'status',      // open | closed
    'created_at',
    'created_by',
    'closed_at',
    'note'
  ],

  // บันทึกการสแกนทุกครั้ง เพิ่มอย่างเดียวไม่แก้ย้อนหลัง
  Scans: [
    'client_scan_id',   // UUID จากเครื่อง ใช้กันข้อมูลซ้ำตอน sync
    'round_id',
    'tag_id',
    'asset_code',       // ว่างได้ ถ้าเป็นแท็กที่ยังไม่ผูก
    'result',           // found | misplaced | unknown
    'status',           // สถานะที่ผู้ตรวจบันทึก ณ เวลาสแกน
    'tag_condition',    // ความสมบูรณ์ของ TAG ณ เวลาสแกน
    'scanned_location', // สถานที่ที่ยืนสแกนจริง
    'device',
    'scanned_by',
    'scanned_at',
    'note',
    'synced_at'
  ],

  Log: ['at', 'action', 'actor', 'detail']
};

/** คืนชีตตามชื่อ สร้างใหม่พร้อม header ถ้ายังไม่มี */
function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, COLUMNS[name].length).setValues([COLUMNS[name]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

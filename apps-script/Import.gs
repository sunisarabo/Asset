/**
 * Import.gs — นำเข้าทะเบียนจากชีตรายงานตรวจนับที่ใช้งานอยู่
 *
 * ชีตต้นทางเป็นแบบฟอร์มรายงาน ไม่ใช่ตารางข้อมูลล้วน หัวตารางมีสองชั้น
 * และมีเซลล์ผสาน (merge) จำนวนมาก โค้ดส่วนนี้จึงอ่านหัวตารางจริง
 * แล้วเดาตำแหน่งคอลัมน์เอง แทนการฮาร์ดโค้ดหมายเลขคอลัมน์
 * ทำให้ยังนำเข้าได้แม้ผู้ใช้แทรกหรือสลับคอลัมน์ในภายหลัง
 */

/** ไอดีของสเปรดชีตต้นทาง ตั้งทับได้ที่ Script Properties คีย์ SOURCE_SPREADSHEET_ID */
var DEFAULT_SOURCE_ID = '1fBIPk1SttNpnzCa3sSzfGoAr-UUNbSRuqC12Wb5Mufs';

/**
 * เรียกจากเมนู หรือรันมือจากหน้า Apps Script
 * อ่านทุกแท็บของชีตต้นทาง หาตารางที่มีหัว "แบ่งแยกตามสถานะ" แล้วนำเข้าทั้งหมด
 */
function importFromSourceSheet() {
  var props = PropertiesService.getScriptProperties();
  var sourceId = props.getProperty('SOURCE_SPREADSHEET_ID') || DEFAULT_SOURCE_ID;
  var result = importFromSpreadsheet_(sourceId);
  logAction_('import', Session.getActiveUser().getEmail(), result);

  SpreadsheetApp.getActiveSpreadsheet().toast(
    'นำเข้า ' + result.total + ' รายการ (ใหม่ ' + result.insert + ' / อัปเดต ' + result.update + ')',
    'นำเข้าข้อมูลสำเร็จ', 10
  );
  return result;
}

function importFromSpreadsheet_(spreadsheetId) {
  var src = SpreadsheetApp.openById(spreadsheetId);
  var rows = [];

  src.getSheets().forEach(function (sheet) {
    var values = sheet.getDataRange().getDisplayValues();
    findTableStarts_(values).forEach(function (start) {
      rows = rows.concat(parseTable_(values, start));
    });
  });

  // กันข้อมูลซ้ำจากการที่รายการเดิมโผล่ในหลายแท็บ ยึดรายการที่พบทีหลัง
  var byCode = {};
  rows.forEach(function (r) { byCode[r.asset_code] = r; });
  var unique = Object.keys(byCode).map(function (k) { return byCode[k]; });

  var result = { total: unique.length, insert: 0, update: 0, skipped: rows.length - unique.length };
  var now = nowIso_();
  unique.forEach(function (r) {
    r.updated_at = now;
    r.updated_by = 'import';
    result[upsert_(SHEETS.ASSETS, 'asset_code', r)]++;
  });
  return result;
}

/** หาแถวหัวตารางทุกตารางในแท็บเดียว — หนึ่งแท็บอาจมีหลายตารางวางต่อกัน */
function findTableStarts_(values) {
  var starts = [];
  for (var r = 0; r < values.length; r++) {
    var joined = values[r].join('|');
    if (/แบ่งแยกตามสถานะ/.test(joined)) starts.push(r);
  }
  return starts;
}

/**
 * อ่านตารางหนึ่งชุด เริ่มจากแถวหัวกลุ่ม
 * คืน array ของ object ที่พร้อมเขียนลงชีต Assets
 */
function parseTable_(values, groupRowIndex) {
  var groupRow = forwardFill_(values[groupRowIndex]);
  var subRow = values[groupRowIndex + 1] || [];

  var col = {
    seq: findCol_(groupRow, /ลำดับที่/),
    name: findCol_(groupRow, /ชื่อรายการ/),
    code: findCol_(groupRow, /^รหัส/),
    location: findCol_(groupRow, /สถานที่/),
    note: findCol_(groupRow, /หมายเหตุ/)
  };
  if (col.code < 0) return [];

  // คอลัมน์จำนวน/หน่วย อยู่ใต้กลุ่ม "จำนวนที่ครอบครอง"
  var ownedCols = colsInGroup_(groupRow, /จำนวนที่ครอบครอง/);
  var qtyCol = ownedCols.length ? ownedCols[0] : -1;
  var unitCol = -1;
  ownedCols.forEach(function (c) {
    if (/หน่วย/.test(String(subRow[c] || ''))) unitCol = c;
    else if (/จำนวน/.test(String(subRow[c] || ''))) qtyCol = c;
  });

  // คอลัมน์สถานะและความสมบูรณ์ของ TAG เป็นกลุ่มติ๊กหนึ่งช่องต่อแถว
  var statusCols = labelledCols_(groupRow, subRow, /แบ่งแยกตามสถานะ/);
  var tagCols = labelledCols_(groupRow, subRow, /ความสมบูรณ์ของ\s*TAG/i);

  // ชื่อเรื่องอยู่เหนือหัวตาราง ใช้แยกว่าเป็นทรัพย์สินหรือสินค้าคงคลัง
  var title = '';
  for (var t = Math.max(0, groupRowIndex - 3); t < groupRowIndex; t++) {
    title += (values[t] || []).join(' ');
  }
  var itemType = /สินค้าคงคลัง|Inventory/i.test(title) ? ITEM_TYPE.INVENTORY : ITEM_TYPE.ASSET;

  var out = [];
  var blankStreak = 0;
  for (var r = groupRowIndex + 2; r < values.length; r++) {
    var row = values[r];
    var code = normalizeCode_(row[col.code]);

    // ตารางถัดไปเริ่มแล้ว — หยุดอ่านตารางนี้
    if (/แบ่งแยกตามสถานะ/.test(row.join('|'))) break;

    if (!/^\d{4,}$/.test(code)) {
      // ยอมให้มีแถวว่างคั่นได้บ้าง แต่ถ้าว่างติดกันมากแปลว่าจบตารางแล้ว
      if (++blankStreak > 8) break;
      continue;
    }
    blankStreak = 0;

    out.push({
      asset_code: code,
      item_type: itemType,
      seq: col.seq >= 0 ? String(row[col.seq] || '').trim() : '',
      name: col.name >= 0 ? String(row[col.name] || '').trim() : '',
      location: col.location >= 0 ? String(row[col.location] || '').trim() : '',
      qty: qtyCol >= 0 ? (String(row[qtyCol] || '').trim() || '1') : '1',
      unit: unitCol >= 0 ? String(row[unitCol] || '').trim() : '',
      status: pickTicked_(row, statusCols) || STATUS.COMPLETE,
      tag_condition: pickTicked_(row, tagCols) || '',
      note: col.note >= 0 ? String(row[col.note] || '').trim() : '',
      active: 'TRUE'
    });
  }
  return out;
}

/**
 * เติมค่าหัวกลุ่มไปทางขวาให้เต็ม
 * เซลล์ผสานจะมีค่าเฉพาะช่องซ้ายสุด ช่องที่เหลือว่าง จึงต้องเติมเองก่อนใช้งาน
 */
function forwardFill_(row) {
  var out = [];
  var last = '';
  for (var i = 0; i < row.length; i++) {
    var v = String(row[i] || '').trim();
    if (v) last = v;
    out[i] = last;
  }
  return out;
}

function findCol_(header, re) {
  for (var i = 0; i < header.length; i++) {
    if (re.test(String(header[i] || '').trim())) return i;
  }
  return -1;
}

function colsInGroup_(groupRow, re) {
  var cols = [];
  for (var i = 0; i < groupRow.length; i++) {
    if (re.test(String(groupRow[i] || ''))) cols.push(i);
  }
  return cols;
}

/** คืนคู่ (ตำแหน่งคอลัมน์, ชื่อสถานะ) ของทุกคอลัมน์ในกลุ่มที่ระบุ */
function labelledCols_(groupRow, subRow, re) {
  return colsInGroup_(groupRow, re).map(function (c) {
    return { col: c, label: String(subRow[c] || '').trim() };
  }).filter(function (x) { return x.label; });
}

/** หาสถานะจากกลุ่มคอลัมน์ติ๊ก — คืนชื่อคอลัมน์แรกที่มีค่าไม่ว่างและไม่ใช่ศูนย์ */
function pickTicked_(row, cols) {
  for (var i = 0; i < cols.length; i++) {
    var v = String(row[cols[i].col] || '').trim();
    if (v && v !== '0') return cols[i].label;
  }
  return '';
}

/** เมนูใน Google Sheets เพื่อให้ผู้ใช้กดนำเข้าได้เองโดยไม่ต้องเปิด Apps Script */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ตรวจนับทรัพย์สิน')
    .addItem('นำเข้าทะเบียนจากชีตต้นทาง', 'importFromSourceSheet')
    .addItem('สร้างชีตระบบให้ครบ', 'setupSheets')
    .addToUi();
}

/** สร้างชีตทั้งหมดพร้อมหัวตาราง ใช้ตอนติดตั้งครั้งแรก */
function setupSheets() {
  Object.keys(SHEETS).forEach(function (k) { getSheet_(SHEETS[k]); });
  SpreadsheetApp.getActiveSpreadsheet().toast('สร้างชีตครบแล้ว', 'ติดตั้ง', 5);
}

/**
 * Db.gs — ชั้นเข้าถึงข้อมูลบน Google Sheets
 *
 * ทุกฟังก์ชันทำงานกับ "แถวเป็น object" เพื่อให้โค้ดส่วนบนไม่ต้องรู้ว่า
 * คอลัมน์อยู่ตำแหน่งไหน ถ้าผู้ใช้สลับคอลัมน์ในชีตเองระบบยังทำงานได้
 * เพราะเราอ่าน header จริงจากแถวที่ 1 เสมอ
 */

/** อ่านทั้งชีตออกมาเป็น array ของ object */
function readAll_(name) {
  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var header = values[0];
  var rows = [];

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // ข้ามแถวว่างที่เกิดจากการลบข้อมูลแต่ไม่ลบแถว
    if (row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      if (header[c]) obj[header[c]] = row[c];
    }
    obj._row = r + 1;
    rows.push(obj);
  }
  return rows;
}

/** อ่าน header จริงของชีต ใช้จัดลำดับค่าก่อนเขียน */
function headerOf_(name) {
  var sh = getSheet_(name);
  var lastCol = Math.max(sh.getLastColumn(), COLUMNS[name].length);
  var header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  // ชีตเพิ่งสร้างหรือ header หาย — เขียนกลับจากนิยามกลาง
  if (!header[0]) {
    header = COLUMNS[name];
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
  }
  return header;
}

/** แปลง object เป็น array เรียงตาม header ของชีต */
function toRow_(name, obj) {
  var header = headerOf_(name);
  return header.map(function (h) {
    var v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
}

/** เพิ่มหลายแถวพร้อมกัน — เร็วกว่า appendRow ทีละแถวมาก */
function appendRows_(name, objects) {
  if (!objects.length) return 0;
  var sh = getSheet_(name);
  var header = headerOf_(name);
  var rows = objects.map(function (o) { return toRow_(name, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  return rows.length;
}

/** เขียนทับแถวเดิมทั้งแถว */
function updateRow_(name, rowIndex, obj) {
  var sh = getSheet_(name);
  var header = headerOf_(name);
  sh.getRange(rowIndex, 1, 1, header.length).setValues([toRow_(name, obj)]);
}

/**
 * เพิ่มหรือแก้ไขแถวโดยใช้คอลัมน์ key
 * คืน 'insert' หรือ 'update' เพื่อให้ผู้เรียกรายงานผลได้
 */
function upsert_(name, keyField, obj) {
  var existing = readAll_(name);
  var key = String(obj[keyField] || '').trim();
  if (!key) throw new Error('ไม่มีค่าในคอลัมน์ ' + keyField);

  for (var i = 0; i < existing.length; i++) {
    if (String(existing[i][keyField]).trim() === key) {
      var merged = existing[i];
      // เขียนทับเฉพาะฟิลด์ที่ส่งมา ฟิลด์อื่นคงค่าเดิมไว้
      Object.keys(obj).forEach(function (k) {
        if (obj[k] !== undefined && obj[k] !== null) merged[k] = obj[k];
      });
      updateRow_(name, existing[i]._row, merged);
      return 'update';
    }
  }
  appendRows_(name, [obj]);
  return 'insert';
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss");
}

function uuid_() {
  return Utilities.getUuid();
}

function logAction_(action, actor, detail) {
  try {
    appendRows_(SHEETS.LOG, [{
      at: nowIso_(),
      action: action,
      actor: actor || '',
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
    }]);
  } catch (err) {
    // การเขียน log ล้มเหลวต้องไม่ทำให้คำขอหลักล้มไปด้วย
    console.error('logAction_ failed: ' + err);
  }
}

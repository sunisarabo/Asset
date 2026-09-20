/**
 * Automation.gs — งานที่ระบบทำเองตามเวลา โดยไม่ต้องมีคนกดสั่ง
 *
 * มีสามงานหลัก ทุกงานตั้งเป็น trigger รายวัน แล้วให้โค้ดเป็นฝ่ายตัดสินเองว่า
 * วันนี้ถึงเวลาทำหรือยัง ไม่ใช้ trigger รายเดือนด้วยเหตุผลสองข้อ
 *
 *   1. trigger รายเดือนของ Apps Script ยึดวันที่ตายตัว จึงสั่ง "วันสุดท้าย
 *      ของเดือน" ไม่ได้ เพราะบางเดือนมี 28 วันและบางเดือนมี 31 วัน
 *   2. ถ้ารอบใดรันไม่สำเร็จ (โควตาเต็ม เน็ตล่ม) งานรายเดือนจะข้ามไปทั้งเดือน
 *      แต่งานรายวันที่ตรวจสภาพก่อนทำจะตามเก็บงานที่ค้างให้เองในวันถัดไป
 *
 * ทุกงานเขียนให้เรียกซ้ำได้โดยไม่เกิดผลซ้ำซ้อน จึงปลอดภัยที่จะกดรันเองด้วยมือ
 */

/** ชื่อฟังก์ชันที่ติดตั้งเป็น trigger ใช้ตอนถอนของเก่าก่อนติดตั้งใหม่ */
var AUTOMATION_HANDLERS = ['autoOpenRound', 'autoDailyDigest', 'autoCloseRound'];

var TZ = 'Asia/Bangkok';

/** ค่าเริ่มต้นเมื่อยังไม่ได้ตั้งใน Script Properties */
var AUTOMATION_DEFAULTS = {
  DIGEST_HOUR: '17',   // สรุปความคืบหน้าตอนเย็นก่อนเลิกงาน
  OPEN_HOUR: '6',      // เปิดวงรอบใหม่ก่อนเริ่มงานเช้า
  CLOSE_HOUR: '22',    // ปิดวงรอบหลังเลิกงานแล้ว
  CLOSE_DAY: '0',      // 0 = วันสุดท้ายของเดือน
  AUTO_OPEN: 'TRUE',
  AUTO_CLOSE: 'TRUE',
  APPLY_ON_CLOSE: 'FALSE' // ไม่เขียนทับทะเบียนเองโดยไม่มีคนตรวจ เว้นแต่สั่งไว้
};

function autoProp_(key) {
  var v = PropertiesService.getScriptProperties().getProperty('AUTOMATION_' + key);
  if (v === null || String(v).trim() === '') return AUTOMATION_DEFAULTS[key];
  return String(v).trim();
}

function autoFlag_(key) {
  return String(autoProp_(key)).toUpperCase() !== 'FALSE';
}

/** แปลงค่าชั่วโมงจาก property ให้อยู่ในช่วง 0–23 เสมอ */
function autoHour_(key) {
  var n = parseInt(autoProp_(key), 10);
  if (isNaN(n) || n < 0 || n > 23) n = parseInt(AUTOMATION_DEFAULTS[key], 10);
  return n;
}

// ---------------------------------------------------------------------------
// ตรรกะวันที่ — เขียนเป็นฟังก์ชันบริสุทธิ์ที่รับสตริง ไม่รับ Date
// เพื่อให้ทดสอบได้โดยไม่ต้องจำลองเขตเวลาของ Apps Script
// ---------------------------------------------------------------------------

/** 'yyyy-MM-dd' → 'yyyy-MM' */
function periodOfKey_(dateKey) {
  return String(dateKey).slice(0, 7);
}

function daysInMonth_(year, month) {
  return [31, isLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function isLeapYear_(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * วันนี้เป็นวันปิดวงรอบหรือยัง
 * setting เป็น '0' หรือค่าที่เกินจำนวนวันของเดือนนั้น หมายถึงวันสุดท้ายของเดือน
 * ซึ่งจำเป็น เพราะถ้าตั้งไว้วันที่ 31 เดือนกุมภาพันธ์จะไม่มีวันนั้นเลย
 */
function isCloseDay_(dateKey, setting) {
  var parts = String(dateKey).split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  if (!year || !month || !day) return false;

  var last = daysInMonth_(year, month);
  var want = parseInt(setting, 10);
  if (isNaN(want) || want < 1 || want > last) want = last;
  return day === want;
}

/** วงรอบที่ยังเปิดอยู่ของงวดที่ระบุ */
function findOpenRound_(rounds, period) {
  for (var i = 0; i < rounds.length; i++) {
    if (String(rounds[i].period) === period && String(rounds[i].status) !== 'closed') {
      return rounds[i];
    }
  }
  return null;
}

/** มีวงรอบของงวดนี้อยู่แล้วหรือไม่ ไม่ว่าจะเปิดหรือปิดไปแล้ว */
function hasRoundForPeriod_(rounds, period) {
  for (var i = 0; i < rounds.length; i++) {
    if (String(rounds[i].period) === period) return true;
  }
  return false;
}

/**
 * วงรอบที่ถึงเวลาปิดแล้ว
 * รวมวงรอบของงวดก่อนหน้าที่ยังค้างเปิดอยู่ด้วย เพื่อให้ระบบตามเก็บงานที่
 * พลาดไปเองได้ แทนที่จะปล่อยค้างสะสมจนผู้ใช้ต้องมาไล่ปิดทีหลัง
 */
function roundsDueToClose_(rounds, todayKey, closeDaySetting) {
  var period = periodOfKey_(todayKey);
  var dueToday = isCloseDay_(todayKey, closeDaySetting);
  return rounds.filter(function (r) {
    if (String(r.status) === 'closed') return false;
    var p = String(r.period || '');
    if (p && p < period) return true;      // ค้างจากงวดก่อน ปิดทันทีที่เจอ
    return p === period && dueToday;
  });
}

function todayKey_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// งานตามเวลา
// ---------------------------------------------------------------------------

/**
 * เปิดวงรอบตรวจนับของเดือนปัจจุบันถ้ายังไม่มี
 *
 * เงื่อนไขคือ "ยังไม่มีวงรอบของงวดนี้เลย" ไม่ใช่ "ไม่มีวงรอบที่เปิดอยู่"
 * มิฉะนั้นวันถัดจากวันปิดวงรอบ ระบบจะเปิดวงรอบของเดือนเดิมขึ้นมาใหม่ซ้ำ
 */
function autoOpenRound() {
  if (!autoFlag_('AUTO_OPEN')) return null;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var period = periodOfKey_(todayKey_());
    if (hasRoundForPeriod_(readAll_(SHEETS.ROUNDS), period)) return null;

    var created = ROUTES['rounds.create']({ period: period, actor: 'ระบบอัตโนมัติ' });
    logAction_('auto.openRound', 'system', created.round.round_id);
    notify_('เปิดวงรอบตรวจนับใหม่แล้ว', [
      created.round.name,
      'เปิดแอปแล้วเริ่มสแกนได้เลย'
    ]);
    return created.round;
  } finally {
    lock.releaseLock();
  }
}

/** ส่งสรุปความคืบหน้าของวงรอบที่เปิดอยู่ */
function autoDailyDigest() {
  var period = periodOfKey_(todayKey_());
  var round = findOpenRound_(readAll_(SHEETS.ROUNDS), period);
  if (!round) return null;

  var report = buildReport_(round.round_id);
  notify_('ความคืบหน้าการตรวจนับ ' + thaiMonthLabel_(period), digestLines_(report));
  return report.summary;
}

/**
 * ปิดวงรอบที่ถึงกำหนด บันทึกรายงานลงชีต แล้วแจ้งผล
 * ไม่เขียนผลกลับเข้าทะเบียนให้เอง เว้นแต่ตั้ง AUTOMATION_APPLY_ON_CLOSE ไว้
 * เพราะการแก้สถานะทรัพย์สินควรผ่านสายตาคนก่อนเป็นค่าเริ่มต้น
 */
function autoCloseRound() {
  if (!autoFlag_('AUTO_CLOSE')) return [];

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var due = roundsDueToClose_(readAll_(SHEETS.ROUNDS), todayKey_(), autoProp_('CLOSE_DAY'));
    var closed = [];

    due.forEach(function (round) {
      var report = buildReport_(round.round_id);
      var sheetName = writeSnapshot_(report);

      if (String(autoProp_('APPLY_ON_CLOSE')).toUpperCase() === 'TRUE') {
        ROUTES['rounds.apply']({ round_id: round.round_id, actor: 'ระบบอัตโนมัติ' });
      }
      ROUTES['rounds.close']({ round_id: round.round_id, actor: 'ระบบอัตโนมัติ' });

      logAction_('auto.closeRound', 'system', { round: round.round_id, sheet: sheetName });
      notify_('ปิดวงรอบ ' + round.name + ' แล้ว',
        digestLines_(report).concat(['บันทึกรายงานไว้ที่ชีต "' + sheetName + '"']));
      closed.push(round.round_id);
    });

    return closed;
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// ข้อความสรุปและรายงาน
// ---------------------------------------------------------------------------

/** บรรทัดสรุปที่ใช้ทั้งในอีเมลและใน Google Chat */
function digestLines_(report) {
  var s = report.summary;
  var lines = [
    'ตรวจแล้ว ' + s.found + ' จาก ' + s.expected + ' รายการ (' + s.percent + '%)',
    'ยังไม่พบ ' + s.missing + ' รายการ'
  ];
  if (s.misplaced) lines.push('พบผิดสถานที่ ' + s.misplaced + ' รายการ');
  if (s.unknown) lines.push('แท็กที่ยังไม่ผูกกับทะเบียน ' + s.unknown + ' รายการ');

  // ไล่ห้องที่ยังเหลือมากที่สุดก่อน เพื่อให้รู้ว่าพรุ่งนี้ควรเริ่มที่ไหน
  var remaining = report.byLocation
    .map(function (g) {
      return { location: g.location, left: g.expected - g.found };
    })
    .filter(function (g) { return g.left > 0; })
    .sort(function (a, b) { return b.left - a.left; })
    .slice(0, 5)
    .map(function (g) { return g.location + ' ' + g.left; });

  if (remaining.length) lines.push('เหลือมากที่สุด: ' + remaining.join(' · '));
  return lines;
}

/** แปลงผลการตรวจนับเป็นตารางสองมิติพร้อมเขียนลงชีต */
function snapshotRows_(report) {
  var s = report.summary;
  var rows = [
    ['รายงานการตรวจนับ ' + report.round.name],
    ['สร้างโดยระบบอัตโนมัติเมื่อ', report.generated_at || ''],
    ['ตรวจพบ', s.found, 'จากทั้งหมด', s.expected, 'คิดเป็น', s.percent + '%'],
    ['ไม่พบ', s.missing, 'ผิดสถานที่', s.misplaced, 'แท็กไม่รู้จัก', s.unknown],
    [],
    ['จำนวนทรัพย์สินแบ่งแยกตามสถานะ'],
    STATUS_ORDER.slice(),
    STATUS_ORDER.map(function (k) { return report.byStatus[k] || 0; }),
    [],
    ['ความสมบูรณ์ของ TAG'],
    TAG_CONDITION_ORDER.slice(),
    TAG_CONDITION_ORDER.map(function (k) { return report.byTagCondition[k] || 0; }),
    [],
    ['ลำดับที่', 'ชื่อรายการ', 'รหัส', 'สถานที่', 'จำนวน', 'หน่วย',
      'ผลการตรวจนับ', 'สถานะ', 'ความสมบูรณ์ของ TAG', 'เวลาที่สแกน', 'หมายเหตุ']
  ];

  function itemRow(asset, scan, result) {
    return [
      asset.seq || '', asset.name || '', asset.asset_code || '', asset.location || '',
      asset.qty || '', asset.unit || '', result,
      (scan && scan.status) || asset.status || '',
      (scan && scan.tag_condition) || asset.tag_condition || '',
      (scan && scan.scanned_at) || '',
      (scan && scan.note) || asset.note || ''
    ];
  }

  report.found.forEach(function (f) { rows.push(itemRow(f.asset, f.scan, 'พบ')); });
  report.missing.forEach(function (m) { rows.push(itemRow(m.asset, null, 'ไม่พบ')); });
  report.misplaced.forEach(function (m) {
    var row = itemRow(m.asset, m.scan, 'พบผิดสถานที่');
    row[10] = 'สแกนได้ที่ ' + (m.scan.scanned_location || 'ไม่ระบุ');
    rows.push(row);
  });
  report.unknown.forEach(function (u) {
    rows.push(['', 'แท็กที่ยังไม่ผูกกับทะเบียน', u.tag_id, '', '', '',
      'ไม่รู้จัก', '', '', u.scan.scanned_at || '', '']);
  });

  return padRows_(rows);
}

/** setValues ต้องการทุกแถวกว้างเท่ากัน จึงเติมช่องว่างให้เท่าแถวที่ยาวที่สุด */
function padRows_(rows) {
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 0);
  return rows.map(function (r) {
    var out = r.slice();
    while (out.length < width) out.push('');
    return out;
  });
}

/**
 * เขียนรายงานลงชีตใหม่ คืนชื่อชีตที่เขียน
 * ถ้าชื่อซ้ำกับรายงานของวงรอบอื่น จะต่อท้ายด้วยลำดับแทนการเขียนทับ
 * เพราะรายงานของวงรอบที่ปิดไปแล้วคือหลักฐานการตรวจนับ ห้ามหาย
 */
function writeSnapshot_(report) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var base = ('รายงาน ' + (report.round.period || '')).trim();
  var name = base;
  var n = 1;

  while (true) {
    var existing = ss.getSheetByName(name);
    if (!existing) break;
    // ชีตเดิมเป็นของวงรอบเดียวกัน — เขียนทับได้ เพราะเป็นรายงานฉบับปรับปรุง
    if (existing.getRange(1, 12).getDisplayValue() === report.round.round_id) {
      existing.clear();
      break;
    }
    n++;
    name = base + ' #' + n;
  }

  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var rows = snapshotRows_(report);
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  // เก็บ round_id ไว้นอกสายตาในคอลัมน์ที่ 12 เพื่อให้รู้ว่าชีตนี้เป็นของวงรอบไหน
  sh.getRange(1, 12).setValue(report.round.round_id);
  sh.setFrozenRows(14);
  return name;
}

// ---------------------------------------------------------------------------
// การแจ้งเตือน
// ---------------------------------------------------------------------------

/**
 * ส่งข้อความออกทุกช่องทางที่ตั้งค่าไว้
 * ถ้าช่องทางใดล้มเหลวต้องไม่ทำให้งานหลักล้มตาม เพราะการปิดวงรอบสำคัญกว่า
 * การส่งข้อความ จึงจับข้อผิดพลาดแยกทีละช่องทาง
 */
function notify_(subject, lines) {
  var text = subject + '\n' + lines.join('\n');
  var sent = [];

  var webhook = PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK');
  if (webhook) {
    try {
      UrlFetchApp.fetch(webhook, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ text: text }),
        muteHttpExceptions: true
      });
      sent.push('chat');
    } catch (err) {
      logAction_('notify.failed', 'system', 'chat: ' + err);
    }
  }

  var mail = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
  if (mail) {
    try {
      MailApp.sendEmail({ to: mail, subject: subject, body: text });
      sent.push('email');
    } catch (err) {
      logAction_('notify.failed', 'system', 'email: ' + err);
    }
  }

  if (!sent.length) logAction_('notify.skipped', 'system', subject);
  return sent;
}

// ---------------------------------------------------------------------------
// ติดตั้งและถอน trigger
// ---------------------------------------------------------------------------

/** ติดตั้ง trigger ทั้งหมดใหม่ ถอนของเดิมก่อนเสมอเพื่อไม่ให้ซ้อนกัน */
function installAutomation() {
  removeAutomation();

  ScriptApp.newTrigger('autoOpenRound').timeBased()
    .atHour(autoHour_('OPEN_HOUR')).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('autoDailyDigest').timeBased()
    .atHour(autoHour_('DIGEST_HOUR')).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('autoCloseRound').timeBased()
    .atHour(autoHour_('CLOSE_HOUR')).everyDays(1).inTimezone(TZ).create();

  logAction_('auto.install', Session.getActiveUser().getEmail(), AUTOMATION_HANDLERS);
  SpreadsheetApp.getActiveSpreadsheet()
    .toast('ตั้งงานอัตโนมัติครบแล้ว', 'ตรวจนับทรัพย์สิน', 5);
}

function removeAutomation() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (AUTOMATION_HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

/** ดูว่าตอนนี้มีงานอัตโนมัติอะไรทำงานอยู่บ้าง เรียกจากเมนูได้ */
function showAutomationStatus() {
  var installed = ScriptApp.getProjectTriggers()
    .filter(function (t) { return AUTOMATION_HANDLERS.indexOf(t.getHandlerFunction()) >= 0; })
    .map(function (t) { return t.getHandlerFunction(); });

  var lines = [
    installed.length ? 'งานที่ตั้งไว้: ' + installed.join(', ') : 'ยังไม่ได้ตั้งงานอัตโนมัติ',
    'เปิดวงรอบเอง: ' + (autoFlag_('AUTO_OPEN') ? 'ใช่' : 'ไม่'),
    'ปิดวงรอบเอง: ' + (autoFlag_('AUTO_CLOSE') ? 'ใช่' : 'ไม่') +
      ' (วันที่ ' + autoProp_('CLOSE_DAY') + ' — 0 คือวันสุดท้ายของเดือน)',
    'เขียนผลกลับทะเบียนตอนปิด: ' + autoProp_('APPLY_ON_CLOSE'),
    'สรุปประจำวันเวลา ' + autoHour_('DIGEST_HOUR') + ':00',
    'แจ้งเตือนทาง Chat: ' +
      (PropertiesService.getScriptProperties().getProperty('CHAT_WEBHOOK') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง'),
    'แจ้งเตือนทางอีเมล: ' +
      (PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL') || 'ยังไม่ตั้ง')
  ];
  SpreadsheetApp.getUi().alert('สถานะงานอัตโนมัติ', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

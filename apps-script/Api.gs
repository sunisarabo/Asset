/**
 * Api.gs — ปลายทาง HTTP ของระบบ
 *
 * แอปมือถือเรียกทุกอย่างผ่าน POST ไปที่ /exec ด้วย Content-Type: text/plain
 * เพื่อเลี่ยง CORS preflight ซึ่ง Apps Script ตอบกลับไม่ได้
 * รูปแบบ body คือ {"action": "...", "key": "...", "payload": {...}}
 */

function doGet(e) {
  // เปิดจากเบราว์เซอร์เพื่อตรวจว่า deploy สำเร็จแล้ว
  return json_({ ok: true, service: 'asset-rfid-audit', time: nowIso_() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'รูปแบบ JSON ไม่ถูกต้อง' });
  }

  try {
    requireAuth_(req.key);
    var handler = ROUTES[req.action];
    if (!handler) throw new Error('ไม่รู้จักคำสั่ง: ' + req.action);
    return json_({ ok: true, data: handler(req.payload || {}, req) });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * ตรวจรหัสเข้าใช้งานที่ตั้งไว้ใน Script Properties (คีย์ ACCESS_KEY)
 * ถ้ายังไม่ตั้ง ระบบจะเปิดให้ใช้ได้เพื่อความสะดวกตอนติดตั้ง
 * แต่ต้องตั้งก่อนใช้งานจริงเสมอ เพราะ web app เปิดสาธารณะ
 */
function requireAuth_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  if (!expected) return;
  if (String(key || '') !== expected) throw new Error('รหัสเข้าใช้งานไม่ถูกต้อง');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

var ROUTES = {
  'ping': function () {
    return { time: nowIso_(), sheet: SpreadsheetApp.getActiveSpreadsheet().getName() };
  },

  /**
   * ดึงข้อมูลทั้งหมดลงเครื่องครั้งเดียว เพื่อให้สแกนต่อได้แม้ไม่มีสัญญาณ
   * ข้อมูลราว 350 รายการ ย่อได้พอดีกับ payload เดียว
   */
  'bootstrap': function () {
    return {
      assets: readAll_(SHEETS.ASSETS),
      tags: readAll_(SHEETS.TAGS),
      rounds: readAll_(SHEETS.ROUNDS).filter(function (r) { return r.status !== 'closed'; }),
      options: {
        status: STATUS_ORDER,
        tag_condition: TAG_CONDITION_ORDER,
        locations: distinctLocations_()
      },
      server_time: nowIso_()
    };
  },

  'assets.list': function () {
    return { assets: readAll_(SHEETS.ASSETS) };
  },

  'assets.upsert': function (p) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var items = p.assets || [p.asset];
      var result = { insert: 0, update: 0 };
      items.forEach(function (a) {
        a.asset_code = normalizeCode_(a.asset_code);
        a.updated_at = nowIso_();
        a.updated_by = p.actor || '';
        result[upsert_(SHEETS.ASSETS, 'asset_code', a)]++;
      });
      logAction_('assets.upsert', p.actor, result);
      return result;
    } finally {
      lock.releaseLock();
    }
  },

  /**
   * ผูกแท็กเข้ากับรายการทรัพย์สิน
   * ถ้าแท็กนี้เคยผูกกับรายการอื่น จะปิดการใช้งานรายการเดิมก่อนเสมอ
   * เพื่อไม่ให้แท็กหนึ่งชี้ไปสองรายการพร้อมกัน
   */
  'tags.bind': function (p) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var tagId = normalizeTag_(p.tag_id);
      var code = normalizeCode_(p.asset_code);
      if (!tagId) throw new Error('ไม่พบรหัสแท็ก');
      if (!code) throw new Error('ไม่พบรหัสทรัพย์สิน');

      var exists = readAll_(SHEETS.ASSETS).some(function (a) {
        return normalizeCode_(a.asset_code) === code;
      });
      if (!exists) throw new Error('ไม่พบรหัส ' + code + ' ในทะเบียน');

      var replaced = null;
      readAll_(SHEETS.TAGS).forEach(function (t) {
        if (normalizeTag_(t.tag_id) !== tagId) return;
        if (normalizeCode_(t.asset_code) === code) return;
        if (String(t.active).toUpperCase() === 'FALSE') return;
        replaced = normalizeCode_(t.asset_code);
        t.active = 'FALSE';
        updateRow_(SHEETS.TAGS, t._row, t);
      });

      upsert_(SHEETS.TAGS, 'tag_id', {
        tag_id: tagId,
        asset_code: code,
        tag_type: p.tag_type || 'unknown',
        active: 'TRUE',
        bound_at: nowIso_(),
        bound_by: p.actor || ''
      });

      logAction_('tags.bind', p.actor, { tag: tagId, asset: code, replaced: replaced });
      return { tag_id: tagId, asset_code: code, replaced_asset_code: replaced };
    } finally {
      lock.releaseLock();
    }
  },

  'rounds.list': function () {
    return { rounds: readAll_(SHEETS.ROUNDS) };
  },

  'rounds.create': function (p) {
    var period = p.period || Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
    var round = {
      round_id: p.round_id || uuid_(),
      name: p.name || ('วงรอบประจำเดือน ' + thaiMonthLabel_(period)),
      period: period,
      scope_type: p.scope_type || 'all',
      scope_value: p.scope_value || '',
      status: 'open',
      created_at: nowIso_(),
      created_by: p.actor || '',
      closed_at: '',
      note: p.note || ''
    };
    upsert_(SHEETS.ROUNDS, 'round_id', round);
    logAction_('rounds.create', p.actor, round.round_id);
    return { round: round };
  },

  'rounds.close': function (p) {
    var target = readAll_(SHEETS.ROUNDS).filter(function (r) {
      return r.round_id === p.round_id;
    })[0];
    if (!target) throw new Error('ไม่พบวงรอบตรวจนับ');
    target.status = 'closed';
    target.closed_at = nowIso_();
    updateRow_(SHEETS.ROUNDS, target._row, target);
    logAction_('rounds.close', p.actor, p.round_id);
    return { round: target };
  },

  /**
   * รับผลสแกนเป็นชุดจากคิวออฟไลน์ของเครื่อง
   * กันข้อมูลซ้ำด้วย client_scan_id เพราะเครื่องอาจส่งซ้ำเมื่อสัญญาณหลุดกลางคัน
   */
  'scans.push': function (p) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var incoming = p.scans || [];
      if (!incoming.length) return { accepted: 0, duplicates: 0 };

      var seen = {};
      readAll_(SHEETS.SCANS).forEach(function (s) { seen[s.client_scan_id] = true; });

      var toInsert = [];
      var duplicates = 0;
      incoming.forEach(function (s) {
        var id = String(s.client_scan_id || '').trim();
        if (!id || seen[id]) { duplicates++; return; }
        seen[id] = true;
        toInsert.push({
          client_scan_id: id,
          round_id: s.round_id || '',
          tag_id: normalizeTag_(s.tag_id),
          asset_code: normalizeCode_(s.asset_code),
          result: s.result || '',
          status: s.status || '',
          tag_condition: s.tag_condition || '',
          scanned_location: s.scanned_location || '',
          device: s.device || '',
          scanned_by: s.scanned_by || '',
          scanned_at: s.scanned_at || nowIso_(),
          note: s.note || '',
          synced_at: nowIso_()
        });
      });

      appendRows_(SHEETS.SCANS, toInsert);
      return { accepted: toInsert.length, duplicates: duplicates };
    } finally {
      lock.releaseLock();
    }
  },

  'rounds.report': function (p) {
    return buildReport_(p.round_id);
  },

  /**
   * ปิดวงรอบแล้วเขียนผลกลับเข้าทะเบียน
   * ใช้เมื่อผู้ตรวจยืนยันว่าสถานะที่สแกนได้คือสถานะล่าสุดที่ถูกต้อง
   */
  'rounds.apply': function (p) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var report = buildReport_(p.round_id);
      var updated = 0;
      report.found.forEach(function (f) {
        var changes = {};
        if (f.scan.status && f.scan.status !== f.asset.status) changes.status = f.scan.status;
        if (f.scan.tag_condition && f.scan.tag_condition !== f.asset.tag_condition) {
          changes.tag_condition = f.scan.tag_condition;
        }
        if (!Object.keys(changes).length) return;
        changes.asset_code = normalizeCode_(f.asset.asset_code);
        changes.updated_at = nowIso_();
        changes.updated_by = p.actor || '';
        upsert_(SHEETS.ASSETS, 'asset_code', changes);
        updated++;
      });
      logAction_('rounds.apply', p.actor, { round: p.round_id, updated: updated });
      return { updated: updated };
    } finally {
      lock.releaseLock();
    }
  }
};

function buildReport_(roundId) {
  var round = readAll_(SHEETS.ROUNDS).filter(function (r) {
    return r.round_id === roundId;
  })[0];
  if (!round) throw new Error('ไม่พบวงรอบตรวจนับ');

  var scans = readAll_(SHEETS.SCANS).filter(function (s) {
    return s.round_id === roundId;
  });
  var report = reconcile_(round, readAll_(SHEETS.ASSETS), readAll_(SHEETS.TAGS), scans);
  // ประทับเวลาไว้ให้รายงานที่บันทึกลงชีตบอกได้ว่าเป็นข้อมูล ณ ตอนไหน
  report.generated_at = nowIso_();
  return report;
}

function distinctLocations_() {
  var seen = {};
  readAll_(SHEETS.ASSETS).forEach(function (a) {
    var loc = String(a.location || '').trim();
    if (loc) seen[loc] = true;
  });
  return Object.keys(seen).sort();
}

var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** แปลง "2568-09" หรือ "2025-09" เป็น "กันยายน 2568" ตามที่ใช้ในรายงาน */
function thaiMonthLabel_(period) {
  var parts = String(period).split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  if (!year || !month) return String(period);
  if (year < 2400) year += 543; // รับทั้ง ค.ศ. และ พ.ศ.
  return THAI_MONTHS[month - 1] + ' ' + year;
}

/**
 * Domain.gs — ตรรกะหลักของการตรวจนับ
 *
 * ตรรกะเทียบผล (reconcile) ถูกเขียนไว้ทั้งที่นี่และใน web/js/reconcile.js
 * เพราะแอปมือถือต้องตัดสินผลได้ทันทีขณะออฟไลน์ ถ้าแก้กติกาต้องแก้ทั้งสองที่
 */

/**
 * ทำให้รหัสแท็กอยู่ในรูปมาตรฐานเดียวกัน
 *
 * เครื่องอ่านแต่ละยี่ห้อส่งค่าต่างรูปแบบ เช่น NFC ให้ "04:1a:2b:3c"
 * ส่วนเครื่อง UHF ให้ "E280-1160-6000" หรือ "e28011606000" การตัดตัวคั่น
 * เฉพาะกรณีที่เป็นเลขฐานสิบหกล้วน ทำให้ค่าเหล่านี้ตรงกัน โดยไม่ทำลาย
 * รหัสที่มีขีดเป็นส่วนหนึ่งของชื่อ เช่น "IT303-304"
 */
function normalizeTag_(raw) {
  var s = String(raw == null ? '' : raw).trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  var stripped = s.replace(/[\s:\-_.]/g, '').toUpperCase();
  if (/^[0-9A-F]+$/.test(stripped) && stripped.length >= 4) return stripped;
  return s.toUpperCase();
}

/**
 * รหัสทรัพย์สินของที่นี่เป็นเลข 8 หลัก เช่น 10020012
 * ผู้ตรวจอาจพิมพ์เว้นวรรคหรือมีขีดติดมา จึงตัดทิ้งก่อนเทียบเสมอ
 */
function normalizeCode_(raw) {
  return String(raw == null ? '' : raw).trim().replace(/[\s\-]/g, '');
}

/** รายการนี้อยู่ในขอบเขตของวงรอบตรวจนับหรือไม่ */
function assetInScope_(asset, round) {
  var type = String(round.scope_type || 'all');
  if (type === 'all') return true;
  var want = String(round.scope_value || '').trim().toLowerCase();
  if (type === 'location') return String(asset.location || '').trim().toLowerCase() === want;
  if (type === 'item_type') return String(asset.item_type || '').trim().toLowerCase() === want;
  return true;
}

/** รายการที่จำหน่ายออกไปแล้วไม่ต้องนำมานับ */
function assetIsActive_(asset) {
  return String(asset.active || 'TRUE').toUpperCase() !== 'FALSE';
}

/**
 * สรุปผลการตรวจนับหนึ่งวงรอบ
 *
 * จัดรายการและแท็กที่สแกนได้ออกเป็น 4 กลุ่ม
 *   found     — อยู่ในขอบเขต และสแกนเจอ
 *   missing   — อยู่ในขอบเขต แต่ยังไม่เจอ
 *   misplaced — สแกนเจอ แต่ทะเบียนบอกว่าอยู่สถานที่อื่น
 *   unknown   — สแกนเจอแท็ก แต่ยังไม่ผูกกับรายการใดในทะเบียน
 *
 * เมื่อสแกนซ้ำรายการเดิม จะยึดผลของ "ครั้งล่าสุด" เสมอ เพราะผู้ตรวจ
 * มักสแกนซ้ำเพื่อแก้สถานะที่บันทึกผิด เช่น กดสมบูรณ์ไปแล้วพบว่าชำรุด
 */
function reconcile_(round, assets, tags, scans) {
  var tagToAsset = {};
  tags.forEach(function (t) {
    if (String(t.active).toUpperCase() === 'FALSE') return;
    tagToAsset[normalizeTag_(t.tag_id)] = normalizeCode_(t.asset_code);
  });

  var assetByCode = {};
  assets.forEach(function (a) { assetByCode[normalizeCode_(a.asset_code)] = a; });

  var inScope = assets.filter(function (a) {
    return assetIsActive_(a) && assetInScope_(a, round);
  });

  var latestByCode = {};
  var unknownTags = {};
  var misplaced = {};

  // เรียงตามเวลาก่อน เพื่อให้การทับค่าให้ผลของครั้งล่าสุดจริง ๆ
  scans.slice().sort(function (a, b) {
    return String(a.scanned_at || '').localeCompare(String(b.scanned_at || ''));
  }).forEach(function (s) {
    var tag = normalizeTag_(s.tag_id);
    // ผู้ตรวจอาจพิมพ์รหัสทรัพย์สินเองเมื่อแท็กหาย จึงรับได้ทั้งสองทาง
    var code = tagToAsset[tag] || (assetByCode[normalizeCode_(s.asset_code)] ? normalizeCode_(s.asset_code) : '');

    if (!code || !assetByCode[code]) {
      unknownTags[tag] = { tag_id: tag, scan: s };
      return;
    }
    var asset = assetByCode[code];
    if (assetInScope_(asset, round) && assetIsActive_(asset)) {
      latestByCode[code] = s;
      delete misplaced[code];
    } else {
      misplaced[code] = { asset: asset, scan: s };
    }
  });

  var found = [];
  var missing = [];
  inScope.forEach(function (a) {
    var code = normalizeCode_(a.asset_code);
    if (latestByCode[code]) {
      found.push({ asset: a, scan: latestByCode[code] });
    } else {
      missing.push({ asset: a });
    }
  });

  return {
    round: round,
    found: found,
    missing: missing,
    misplaced: Object.keys(misplaced).map(function (k) { return misplaced[k]; }),
    unknown: Object.keys(unknownTags).map(function (k) { return unknownTags[k]; }),
    summary: {
      expected: inScope.length,
      found: found.length,
      missing: missing.length,
      misplaced: Object.keys(misplaced).length,
      unknown: Object.keys(unknownTags).length,
      percent: inScope.length ? Math.round((found.length / inScope.length) * 100) : 0
    },
    byStatus: countBy_(found, function (f) { return f.scan.status || STATUS.COMPLETE; }, STATUS_ORDER),
    byTagCondition: countBy_(found, function (f) { return f.scan.tag_condition || TAG_CONDITION.COMPLETE; }, TAG_CONDITION_ORDER),
    byLocation: groupCount_(inScope, latestByCode)
  };
}

/**
 * เรียงชื่อสถานที่ให้ตรงลำดับที่ใช้ในรายงานเดิม
 * ในตารางของแผนก "DOM LL 02" และ "ROW C ROW G ROW J" อยู่ก่อนกลุ่ม "ห้อง ..." เสมอ
 * ต้องตรงกับ compareLocation ใน web/js/reconcile.js
 */
function compareLocation_(a, b) {
  var isThaiA = /^[\u0E00-\u0E7F]/.test(String(a).trim());
  var isThaiB = /^[\u0E00-\u0E7F]/.test(String(b).trim());
  if (isThaiA !== isThaiB) return isThaiA ? 1 : -1;
  return String(a).localeCompare(String(b), 'th');
}

/** นับจำนวนตามคีย์ พร้อมรับประกันว่าคีย์ในลำดับมาตรฐานมีครบทุกตัว */
function countBy_(items, keyFn, order) {
  var out = {};
  (order || []).forEach(function (k) { out[k] = 0; });
  items.forEach(function (it) {
    var k = keyFn(it);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

/** สรุปความคืบหน้าแยกตามสถานที่ ใช้แสดงหน้าจอว่าห้องไหนตรวจครบแล้ว */
function groupCount_(inScope, latestByCode) {
  var map = {};
  inScope.forEach(function (a) {
    var loc = String(a.location || '(ไม่ระบุ)').trim();
    if (!map[loc]) map[loc] = { location: loc, expected: 0, found: 0 };
    map[loc].expected++;
    if (latestByCode[normalizeCode_(a.asset_code)]) map[loc].found++;
  });
  return Object.keys(map).sort(compareLocation_).map(function (k) { return map[k]; });
}

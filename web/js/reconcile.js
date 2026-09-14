/**
 * reconcile.js — ตรรกะเทียบผลการตรวจนับฝั่งเครื่องสแกน
 *
 * เป็นคู่แฝดของ apps-script/Domain.gs เครื่องต้องตัดสินผลได้เองทันที
 * ขณะออฟไลน์ เพื่อบอกผู้ตรวจว่าชิ้นที่เพิ่งสแกนอยู่ในรายการหรือไม่
 * ถ้าแก้กติกาที่นี่ ต้องแก้ใน Domain.gs ให้ตรงกันด้วย
 */

export const STATUS = {
  COMPLETE: 'สมบูรณ์',
  DAMAGED: 'ชำรุด',
  LOST: 'สูญหาย',
  TO_TRANSFER: 'เตรียมโอนย้าย',
  TO_DISPOSE: 'เตรียมจำหน่าย',
  REPAIR: 'ส่งซ่อม',
  OTHER: 'อื่นๆ'
};
export const STATUS_ORDER = [
  STATUS.COMPLETE, STATUS.DAMAGED, STATUS.LOST,
  STATUS.TO_TRANSFER, STATUS.TO_DISPOSE, STATUS.REPAIR, STATUS.OTHER
];

export const TAG_CONDITION = { COMPLETE: 'สมบูรณ์', DAMAGED: 'ชำรุด', LOST: 'สูญหาย' };
export const TAG_CONDITION_ORDER = [
  TAG_CONDITION.COMPLETE, TAG_CONDITION.DAMAGED, TAG_CONDITION.LOST
];

export const RESULT = { FOUND: 'found', MISPLACED: 'misplaced', UNKNOWN: 'unknown' };

/**
 * ทำให้รหัสแท็กอยู่ในรูปมาตรฐานเดียวกัน
 * เครื่องอ่านแต่ละยี่ห้อส่งค่าต่างรูปแบบ เช่น "04:1a:2b:3c" กับ "E280-1160-6000"
 * ตัดตัวคั่นเฉพาะกรณีเป็นเลขฐานสิบหกล้วน เพื่อไม่ทำลายรหัสอย่าง "IT303-304"
 */
export function normalizeTag(raw) {
  const s = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!s) return '';
  const stripped = s.replace(/[\s:\-_.]/g, '').toUpperCase();
  if (/^[0-9A-F]+$/.test(stripped) && stripped.length >= 4) return stripped;
  return s.toUpperCase();
}

/** รหัสทรัพย์สินที่นี่เป็นเลข 8 หลัก ตัดช่องว่างและขีดที่ผู้ใช้พิมพ์ติดมา */
export function normalizeCode(raw) {
  return String(raw ?? '').trim().replace(/[\s-]/g, '');
}

export function assetInScope(asset, round) {
  const type = String(round?.scope_type || 'all');
  if (type === 'all') return true;
  const want = String(round.scope_value || '').trim().toLowerCase();
  if (type === 'location') return String(asset.location || '').trim().toLowerCase() === want;
  if (type === 'item_type') return String(asset.item_type || '').trim().toLowerCase() === want;
  return true;
}

/**
 * เรียงชื่อสถานที่ให้ตรงลำดับที่ใช้ในรายงานเดิม
 * การเรียงตามภาษาไทยจะดันชื่อที่ขึ้นต้นด้วยอักษรไทยมาก่อนอักษรโรมัน
 * แต่ในตารางรายงานของแผนก "DOM LL 02" และ "ROW C ROW G ROW J" อยู่ก่อน
 * กลุ่ม "ห้อง ..." เสมอ จึงต้องแยกสองกลุ่มก่อนแล้วค่อยเรียงภายในกลุ่ม
 */
export function compareLocation(a, b) {
  const isThai = s => /^[\u0E00-\u0E7F]/.test(String(s).trim());
  if (isThai(a) !== isThai(b)) return isThai(a) ? 1 : -1;
  return String(a).localeCompare(String(b), 'th');
}

export function assetIsActive(asset) {
  return String(asset.active ?? 'TRUE').toUpperCase() !== 'FALSE';
}

/** สร้างดัชนีค้นหาไว้ล่วงหน้า เพื่อให้การสแกนแต่ละครั้งตอบได้ทันที */
export function buildIndex(assets, tags) {
  const byCode = new Map();
  assets.forEach(a => byCode.set(normalizeCode(a.asset_code), a));

  const tagToCode = new Map();
  tags.forEach(t => {
    if (String(t.active).toUpperCase() === 'FALSE') return;
    tagToCode.set(normalizeTag(t.tag_id), normalizeCode(t.asset_code));
  });

  return { byCode, tagToCode };
}

/**
 * ตัดสินผลของการสแกนหนึ่งครั้ง
 * รับได้ทั้งรหัสแท็กและรหัสทรัพย์สิน เพราะผู้ตรวจต้องพิมพ์รหัสเองเมื่อแท็กหาย
 */
export function resolveScan(raw, index, round) {
  const tag = normalizeTag(raw);
  const code = index.tagToCode.get(tag)
    || (index.byCode.has(normalizeCode(raw)) ? normalizeCode(raw) : '');

  const asset = code ? index.byCode.get(code) : null;
  if (!asset) return { result: RESULT.UNKNOWN, tag_id: tag, asset: null };

  const inScope = assetInScope(asset, round) && assetIsActive(asset);
  return {
    result: inScope ? RESULT.FOUND : RESULT.MISPLACED,
    tag_id: tag,
    asset
  };
}

/**
 * สรุปผลทั้งวงรอบ
 * เมื่อสแกนซ้ำรายการเดิม ยึดผลของครั้งล่าสุดเสมอ เพราะผู้ตรวจมักสแกนซ้ำ
 * เพื่อแก้สถานะที่บันทึกผิด เช่น กดสมบูรณ์ไปแล้วเพิ่งเห็นว่าชำรุด
 */
export function reconcile(round, assets, tags, scans) {
  const index = buildIndex(assets, tags);
  const inScope = assets.filter(a => assetIsActive(a) && assetInScope(a, round));

  const latestByCode = new Map();
  const unknown = new Map();
  const misplaced = new Map();

  [...scans]
    .sort((a, b) => String(a.scanned_at || '').localeCompare(String(b.scanned_at || '')))
    .forEach(s => {
      const tag = normalizeTag(s.tag_id);
      const code = index.tagToCode.get(tag)
        || (index.byCode.has(normalizeCode(s.asset_code)) ? normalizeCode(s.asset_code) : '');
      const asset = code ? index.byCode.get(code) : null;

      if (!asset) {
        unknown.set(tag, { tag_id: tag, scan: s });
        return;
      }
      if (assetInScope(asset, round) && assetIsActive(asset)) {
        latestByCode.set(code, s);
        misplaced.delete(code);
      } else {
        misplaced.set(code, { asset, scan: s });
      }
    });

  const found = [];
  const missing = [];
  inScope.forEach(a => {
    const code = normalizeCode(a.asset_code);
    const scan = latestByCode.get(code);
    if (scan) found.push({ asset: a, scan });
    else missing.push({ asset: a });
  });

  return {
    round,
    found,
    missing,
    misplaced: [...misplaced.values()],
    unknown: [...unknown.values()],
    summary: {
      expected: inScope.length,
      found: found.length,
      missing: missing.length,
      misplaced: misplaced.size,
      unknown: unknown.size,
      percent: inScope.length ? Math.round((found.length / inScope.length) * 100) : 0
    },
    byStatus: countBy(found, f => f.scan.status || STATUS.COMPLETE, STATUS_ORDER),
    byTagCondition: countBy(found, f => f.scan.tag_condition || TAG_CONDITION.COMPLETE, TAG_CONDITION_ORDER),
    byLocation: groupByLocation(inScope, latestByCode)
  };
}

function countBy(items, keyFn, order) {
  const out = {};
  order.forEach(k => { out[k] = 0; });
  items.forEach(it => {
    const k = keyFn(it);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

function groupByLocation(inScope, latestByCode) {
  const map = new Map();
  inScope.forEach(a => {
    const loc = String(a.location || '(ไม่ระบุ)').trim();
    if (!map.has(loc)) map.set(loc, { location: loc, expected: 0, found: 0 });
    const g = map.get(loc);
    g.expected++;
    if (latestByCode.has(normalizeCode(a.asset_code))) g.found++;
  });
  return [...map.values()].sort((a, b) => compareLocation(a.location, b.location));
}

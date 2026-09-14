/**
 * ทดสอบตรรกะเทียบผลการตรวจนับฝั่งแอปมือถือ
 * เป็นส่วนที่ตัดสินว่าของชิ้นไหน "พบ / ไม่พบ / ผิดที่" จึงต้องถูกต้องเสมอ
 */

import {
  reconcile, buildIndex, resolveScan, normalizeTag, normalizeCode, RESULT, STATUS
} from '../web/js/reconcile.js';

let failures = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (!ok) {
    failures++;
    console.log('   got  ' + JSON.stringify(got) + '\n   want ' + JSON.stringify(want));
  }
}

const assets = [
  { asset_code: '10020012', name: 'Notebook HP', location: 'DOM LL 02', item_type: 'asset', active: 'TRUE' },
  { asset_code: '10013338', name: 'ถังดับเพลิง', location: 'DOM LL 02', item_type: 'asset', active: 'TRUE' },
  { asset_code: '10021696', name: 'IPAD A16', location: 'ห้อง IT101', item_type: 'asset', active: 'TRUE' },
  { asset_code: '10023119', name: 'เครื่องฟอกอากาศ', location: 'ห้อง IT101', item_type: 'asset', active: 'FALSE' }
];

const tags = [
  { tag_id: 'E2801160000010020012', asset_code: '10020012', active: 'TRUE' },
  { tag_id: 'E2801160000010013338', asset_code: '10013338', active: 'TRUE' },
  { tag_id: 'E2801160000010021696', asset_code: '10021696', active: 'TRUE' },
  // แท็กเดิมของ Notebook ที่ถูกเปลี่ยนแล้ว ต้องไม่ถูกนำมาใช้อีก
  { tag_id: 'AAAA0000', asset_code: '10020012', active: 'FALSE' }
];

const scanAt = (tag, at, extra = {}) => ({
  tag_id: tag, scanned_at: at, status: STATUS.COMPLETE, tag_condition: 'สมบูรณ์', ...extra
});

// ---- ตัดสินผลรายครั้ง ----
const roundAll = { round_id: 'r1', scope_type: 'all', scope_value: '' };
const index = buildIndex(assets, tags);

check('สแกนแท็กที่ผูกแล้ว → พบ',
  resolveScan('E2801160000010020012', index, roundAll).result, RESULT.FOUND);

check('พิมพ์รหัสทรัพย์สินเองก็ต้องเจอ',
  resolveScan('10013338', index, roundAll).result, RESULT.FOUND);

check('แท็กแปลกปลอม → ไม่รู้จัก',
  resolveScan('E2009A7012345678', index, roundAll).result, RESULT.UNKNOWN);

check('แท็กที่ถูกยกเลิกแล้ว → ไม่รู้จัก',
  resolveScan('AAAA0000', index, roundAll).result, RESULT.UNKNOWN);

// ---- ขอบเขตตามสถานที่ ----
const roundDom = { round_id: 'r2', scope_type: 'location', scope_value: 'DOM LL 02' };

check('ของห้องอื่นที่สแกนเจอในรอบนี้ → ผิดที่',
  resolveScan('E2801160000010021696', index, roundDom).result, RESULT.MISPLACED);

// ---- สรุปทั้งวงรอบ ----
let r = reconcile(roundDom, assets, tags, [
  scanAt('E2801160000010020012', '2026-09-14T09:00:00Z'),
  scanAt('E2801160000010021696', '2026-09-14T09:01:00Z'),  // ของห้อง IT101
  scanAt('E2009A7012345678', '2026-09-14T09:02:00Z')       // แท็กแปลกปลอม
]);
check('ขอบเขต DOM LL 02 มี 2 รายการ', r.summary.expected, 2);
check('พบ 1 ขาด 1', [r.summary.found, r.summary.missing], [1, 1]);
check('ผิดที่ 1 ไม่รู้จัก 1', [r.summary.misplaced, r.summary.unknown], [1, 1]);
check('รายการที่ยังไม่พบคือถังดับเพลิง', r.missing[0].asset.asset_code, '10013338');
check('เปอร์เซ็นต์ความคืบหน้า', r.summary.percent, 50);

// ---- สแกนซ้ำเพื่อแก้สถานะ ----
r = reconcile(roundDom, assets, tags, [
  scanAt('E2801160000010020012', '2026-09-14T09:00:00Z', { status: 'สมบูรณ์' }),
  scanAt('E2801160000010020012', '2026-09-14T09:05:00Z', { status: 'ชำรุด' })
]);
check('สแกนซ้ำแล้วยังนับเป็นชิ้นเดียว', r.summary.found, 1);
check('ยึดสถานะของครั้งล่าสุด', r.found[0].scan.status, 'ชำรุด');
check('สรุปตามสถานะถูกต้อง', [r.byStatus['สมบูรณ์'], r.byStatus['ชำรุด']], [0, 1]);

// ---- รายการที่ปิดใช้งานแล้ว ----
r = reconcile({ round_id: 'r3', scope_type: 'location', scope_value: 'ห้อง IT101' }, assets, tags, []);
check('รายการ active=FALSE ไม่ถูกนำมานับ', r.summary.expected, 1);

// ---- สรุปตามสถานที่ ----
r = reconcile(roundAll, assets, tags, [scanAt('E2801160000010020012', '2026-09-14T09:00:00Z')]);
check('แยกความคืบหน้าตามสถานที่',
  r.byLocation.map(g => [g.location, g.found, g.expected]),
  [['DOM LL 02', 1, 2], ['ห้อง IT101', 0, 1]]);

// ---- การทำรหัสให้เป็นมาตรฐาน ----
check('NFC UID มีโคลอน', normalizeTag('04:1a:2b:3c'), '041A2B3C');
check('EPC มีขีดคั่น', normalizeTag('E280-1160-6000'), 'E28011606000');
check('รหัสที่ไม่ใช่ hex ต้องคงรูป', normalizeTag('ห้อง IT303-304'), 'ห้อง IT303-304');
check('รหัสทรัพย์สินมีช่องว่าง', normalizeCode(' 1002 0012 '), '10020012');

console.log(failures ? `\nไม่ผ่าน ${failures} กรณี` : '\nทุกกรณีผ่าน');
process.exit(failures ? 1 : 0);

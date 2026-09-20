/**
 * api.js — คุยกับ Apps Script web app และจัดคิวส่งข้อมูลตอนออฟไลน์
 *
 * Apps Script ตอบ CORS preflight ไม่ได้ ทุกคำขอจึงต้องเป็น "simple request"
 * คือ POST ที่ Content-Type เป็น text/plain และไม่มี header เพิ่มเอง
 * รหัสเข้าใช้งานจึงเดินทางไปใน body แทนที่จะเป็น Authorization header
 */

import { getConfig } from './config.js';
import { store } from './store.js';
import { demoData } from './demo.js';

export class ApiError extends Error {}

async function call(action, payload = {}) {
  const cfg = getConfig();
  if (cfg.demo) return demoCall(action, payload);

  if (!cfg.endpoint) throw new ApiError('ยังไม่ได้ตั้งค่าที่อยู่เซิร์ฟเวอร์');

  let res;
  try {
    res = await fetch(cfg.endpoint, {
      method: 'POST',
      // ห้ามตั้ง Content-Type เป็น application/json มิฉะนั้นเบราว์เซอร์จะยิง preflight
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: cfg.accessKey, payload }),
      redirect: 'follow'
    });
  } catch (err) {
    throw new ApiError('ติดต่อเซิร์ฟเวอร์ไม่ได้ — ' + err.message);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Apps Script ส่งหน้า HTML กลับมาเมื่อสิทธิ์การ deploy ไม่ถูกต้อง
    throw new ApiError('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ ตรวจสอบว่า deploy เป็น "ทุกคนที่มีลิงก์" แล้ว');
  }
  if (!body.ok) throw new ApiError(body.error || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์');
  return body.data;
}

export const api = {
  ping: () => call('ping'),
  bootstrap: () => call('bootstrap'),
  bindTag: p => call('tags.bind', p),
  createRound: p => call('rounds.create', p),
  closeRound: p => call('rounds.close', p),
  applyRound: p => call('rounds.apply', p),
  report: roundId => call('rounds.report', { round_id: roundId }),
  upsertAssets: p => call('assets.upsert', p),
  pushScans: p => call('scans.push', p)
};

/**
 * ดึงทะเบียนทั้งชุดมาเก็บบนเครื่อง
 * ทำครั้งเดียวตอนเริ่มรอบ แล้วสแกนต่อได้ยาว ๆ โดยไม่ต้องใช้สัญญาณอีก
 */
export async function syncDown() {
  const data = await api.bootstrap();
  await store.replaceAll('assets', data.assets || []);
  await store.replaceAll('tags', data.tags || []);
  await store.replaceAll('rounds', data.rounds || []);
  await store.meta('options', data.options || {});
  await store.meta('lastSync', new Date().toISOString());
  return data;
}

/**
 * ส่งผลสแกนที่ค้างคิวขึ้นเซิร์ฟเวอร์
 * ส่งครั้งละไม่เกิน 200 รายการ เพื่อไม่ให้ Apps Script ทำงานเกินเวลาที่อนุญาต
 */
export async function syncUp() {
  const pending = await store.pendingScans();
  if (!pending.length) return { sent: 0, remaining: 0 };

  const batch = pending.slice(0, 200);
  const res = await api.pushScans({ scans: batch.map(stripLocalFields) });
  await store.markSynced(batch.map(s => s.client_scan_id));

  return {
    sent: res.accepted ?? batch.length,
    duplicates: res.duplicates ?? 0,
    remaining: pending.length - batch.length
  };
}

/** ฟิลด์ที่ขึ้นต้นด้วย pending เป็นสถานะภายในเครื่อง ไม่ต้องส่งขึ้นเซิร์ฟเวอร์ */
function stripLocalFields(scan) {
  const { pending, ...rest } = scan;
  return rest;
}

// ---- โหมดสาธิต ----
// ใช้ทดลองการสแกนและดูหน้าจอรายงานได้ครบโดยยังไม่ต้องติดตั้ง backend

async function demoCall(action, payload) {
  await new Promise(r => setTimeout(r, 120)); // หน่วงให้เหมือนเรียกผ่านเน็ตจริง
  switch (action) {
    case 'ping':
      return { time: new Date().toISOString(), sheet: 'โหมดสาธิต' };
    case 'bootstrap':
      return demoData();
    case 'scans.push':
      return { accepted: (payload.scans || []).length, duplicates: 0 };
    case 'tags.bind':
      return { tag_id: payload.tag_id, asset_code: payload.asset_code, replaced_asset_code: null };
    case 'rounds.create':
      return { round: { ...payload, round_id: payload.round_id || 'demo-round', status: 'open' } };
    default:
      return {};
  }
}

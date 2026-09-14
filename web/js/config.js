/**
 * config.js — ค่าตั้งของเครื่องที่ใช้สแกน
 *
 * เก็บใน localStorage เพราะเป็นค่าประจำเครื่อง ไม่ใช่ข้อมูลที่ต้อง sync
 * และต้องอ่านได้ทันทีตอนเปิดแอปก่อน IndexedDB จะพร้อม
 */

const KEY = 'asset-audit.config';

const DEFAULTS = {
  endpoint: '',        // URL ของ Apps Script web app (ลงท้ายด้วย /exec)
  accessKey: '',       // รหัสเข้าใช้งานที่ตรงกับ ACCESS_KEY ฝั่ง Apps Script
  inspector: '',       // ชื่อผู้ตรวจ ติดไปกับทุกบรรทัดที่สแกน
  device: '',          // ชื่อเครื่อง ใช้ตามรอยว่าใครสแกนจากเครื่องไหน
  defaultLocation: '', // สถานที่ที่กำลังยืนตรวจ
  scanSource: 'auto',  // auto | nfc | hid | camera | manual
  beep: true,
  vibrate: true,
  demo: false          // โหมดสาธิต ใช้ข้อมูลจำลองโดยไม่ต่อ backend
};

let cache = null;

export function getConfig() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  if (!cache.device) {
    // ตั้งชื่อเครื่องอัตโนมัติครั้งแรก ผู้ใช้แก้ทีหลังได้ในหน้าตั้งค่า
    cache.device = 'เครื่อง-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    saveConfig(cache);
  }
  return cache;
}

export function saveConfig(patch) {
  cache = { ...getConfig(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cache));
  return cache;
}

export function isConfigured() {
  const c = getConfig();
  return c.demo || Boolean(c.endpoint);
}

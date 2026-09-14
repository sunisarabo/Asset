/**
 * ทดสอบการใช้งานจริงบนเบราว์เซอร์ขนาดหน้าจอมือถือ
 *
 * ครอบคลุมเส้นทางหลักที่ผู้ตรวจใช้ทุกวัน คือ สแกน → แก้สถานะ → ผูกแท็ก → ดูรายงาน
 * และตรวจว่าหน้าจอไม่ล้นแนวนอน ซึ่งเป็นข้อบกพร่องที่เคยทำให้แถบปุ่มด้านล่าง
 * หลุดออกนอกจอบนมือถือจนกดไม่ได้
 *
 * ต้องติดตั้ง playwright ก่อน:  npm install -g playwright
 * รันด้วย:  node test/smoke.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  // กันการอ่านไฟล์นอกโฟลเดอร์ web ด้วย path ที่มี ..
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return import(path.join(globalRoot, 'playwright', 'index.mjs'));
  }
}

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log('PASS  ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL  ' + name + ' — ' + e.message.split('\n')[0]);
  }
}

const { chromium } = await loadPlaywright();
// ใช้พอร์ตว่างที่ระบบจัดให้ เพื่อไม่ชนกับเซิร์ฟเวอร์อื่นที่อาจค้างอยู่
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});

// เปิดโหมดสาธิตล่วงหน้า เพื่อให้แอปมีข้อมูลทันทีโดยไม่ต้องต่อ backend
await ctx.addInitScript(() => {
  localStorage.setItem('asset-audit.config', JSON.stringify({
    demo: true, inspector: 'ผู้ตรวจทดสอบ', defaultLocation: 'DOM LL 02', device: 'มือถือทดสอบ'
  }));
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

/** หน้าเว็บต้องไม่เลื่อนแนวนอนได้เลย มิฉะนั้นแถบปุ่มล่างจะหลุดจอ */
async function assertNoHorizontalOverflow(where) {
  const bad = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= W + 1) return null;
    const culprits = [...document.querySelectorAll('body *')]
      .filter(el => el.getBoundingClientRect().right > W + 1)
      .slice(0, 3)
      .map(el => el.tagName + '.' + String(el.className || '').split(' ')[0]);
    return { scrollWidth: document.documentElement.scrollWidth, clientWidth: W, culprits };
  });
  if (bad) {
    throw new Error(`${where}: กว้าง ${bad.scrollWidth} เกิน ${bad.clientWidth} — ${bad.culprits.join(', ')}`);
  }
}

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

await step('โหลดทะเบียนจากโหมดสาธิตได้', async () => {
  const text = await page.textContent('#progress-text');
  if (!/\/ 25 /.test(text)) throw new Error('ความคืบหน้า = ' + text);
});

await step('เลือกวิธีอ่านแบบพิมพ์เองได้', async () => {
  await page.getByRole('button', { name: 'พิมพ์เอง' }).click();
  await page.waitForTimeout(150);
});

await step('สแกนแท็กที่ผูกไว้แล้ว → พบแล้ว', async () => {
  await page.fill('#manual-input', 'E280116010020012');
  await page.click('#manual-form button[type=submit]');
  await page.waitForTimeout(300);
  const title = (await page.textContent('#result-title')).trim();
  if (title !== 'พบแล้ว') throw new Error('ได้ "' + title + '"');
  if (await page.textContent('#stat-found') !== '1') throw new Error('ตัวนับไม่เพิ่ม');
});

await step('หน้าจอไม่ล้นแนวนอนหลังมีรายการสแกน',
  () => assertNoHorizontalOverflow('หน้าสแกน'));

await step('สแกนซ้ำต้องไม่นับเพิ่ม', async () => {
  await page.fill('#manual-input', '10020012');
  await page.click('#manual-form button[type=submit]');
  await page.waitForTimeout(300);
  if (await page.textContent('#stat-found') !== '1') throw new Error('นับซ้ำ');
});

await step('กดแก้สถานะเป็นชำรุดได้', async () => {
  await page.locator('#amend-status .chip', { hasText: 'ชำรุด' }).first().click();
  await page.waitForTimeout(300);
  const active = (await page.textContent('#amend-status .chip.is-active')).trim();
  if (active !== 'ชำรุด') throw new Error('ชิปที่เลือกคือ ' + active);
});

await step('ยิงซ้ำหลังแก้เป็นชำรุดแล้ว ต้องไม่ย้อนกลับเป็นสมบูรณ์', async () => {
  // ต้องรอให้พ้นช่วงกันยิงซ้ำ 2 วินาทีก่อน มิฉะนั้นการสแกนจะถูกคัดออกตั้งแต่ต้น
  // และไม่ได้เดินผ่านเส้นทางที่หยิบสถานะจากการสแกนครั้งก่อนมาใช้ต่อ
  await page.waitForTimeout(2200);
  await page.fill('#manual-input', 'E280116010020012');
  await page.click('#manual-form button[type=submit]');
  await page.waitForTimeout(300);
  const active = (await page.textContent('#amend-status .chip.is-active')).trim();
  if (active !== 'ชำรุด') throw new Error('สถานะย้อนกลับเป็น ' + active);
  const badge = await page.locator('#recent-list .badge').first().textContent();
  if (badge.trim() !== 'ชำรุด') throw new Error('รายการล่าสุดแสดง ' + badge);
});

await step('แท็กแปลกปลอมเปิดหน้าผูกแท็กให้อัตโนมัติ', async () => {
  await page.fill('#manual-input', 'E2009A7099999999');
  await page.click('#manual-form button[type=submit]');
  await page.waitForTimeout(400);
  if (!await page.locator('#bind-dialog[open]').count()) throw new Error('กล่องไม่เปิด');
});

await step('ผูกแท็กกับทรัพย์สินที่เลือกได้', async () => {
  await page.fill('#bind-search', '10021730');
  await page.waitForTimeout(250);
  await page.locator('#bind-results .list-item').first().click();
  await page.waitForTimeout(500);
  if (await page.locator('#bind-dialog[open]').count()) throw new Error('กล่องไม่ปิด');
  if (await page.textContent('#stat-unknown') !== '0') throw new Error('ยังนับเป็นแท็กไม่รู้จัก');
});

await step('กดแถบปุ่มด้านล่างเพื่อไปหน้าผลตรวจได้', async () => {
  await page.locator('.tabbar-btn', { hasText: 'ผลตรวจ' }).click({ timeout: 5000 });
  await page.waitForTimeout(300);
  const cards = await page.locator('.summary-card b').allTextContents();
  if (cards.length !== 4) throw new Error('การ์ดสรุป = ' + cards.length);
});

await step('เรียงสถานที่แบบเดียวกับรายงานเดิม', async () => {
  const locs = await page.locator('#location-list .list-title').allTextContents();
  if (locs[0] !== 'DOM LL 02') throw new Error('สถานที่แรก = ' + locs[0]);
  if (!locs.at(-1).startsWith('ห้อง')) throw new Error('สถานที่สุดท้าย = ' + locs.at(-1));
});

await step('หน้าผลตรวจไม่ล้นแนวนอน', () => assertNoHorizontalOverflow('หน้าผลตรวจ'));

await step('หน้าทะเบียนค้นหาได้', async () => {
  await page.locator('.tabbar-btn', { hasText: 'ทะเบียน' }).click({ timeout: 5000 });
  await page.fill('#asset-search', 'IPAD');
  await page.waitForTimeout(300);
  const rows = await page.locator('#asset-list .list-item').count();
  if (rows !== 2) throw new Error('พบ ' + rows + ' แถว');
});

await step('หน้าทะเบียนไม่ล้นแนวนอน', () => assertNoHorizontalOverflow('หน้าทะเบียน'));

await step('ไม่มี JavaScript error ระหว่างใช้งาน', () => {
  if (errors.length) throw new Error(errors.join(' | '));
});

await browser.close();
server.close();

console.log(failures ? `\nไม่ผ่าน ${failures} กรณี` : '\nทุกกรณีผ่าน');
process.exit(failures ? 1 : 0);

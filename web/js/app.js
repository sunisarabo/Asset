/**
 * app.js — ประกอบทุกส่วนเข้าด้วยกันและควบคุมหน้าจอ
 *
 * หลักการที่ยึดตลอดไฟล์นี้
 *   1. ทุกอย่างทำงานได้ขณะออฟไลน์ การสแกนเขียนลง IndexedDB ก่อนเสมอ
 *      แล้วค่อยส่งขึ้นเซิร์ฟเวอร์เมื่อมีสัญญาณ ผู้ตรวจไม่ต้องรอเน็ต
 *   2. การสแกนต้องไม่มีขั้นตอนคั่น ชิ้นที่สมบูรณ์ซึ่งเป็นกรณีส่วนใหญ่
 *      ถูกบันทึกทันทีที่อ่านแท็กติด ส่วนชิ้นที่ผิดปกติค่อยกดแก้ทีหลัง
 */

import { getConfig, saveConfig, isConfigured } from './config.js';
import { store } from './store.js';
import { api, syncDown, syncUp, ApiError } from './api.js';
import { Scanner, capabilities } from './scanner.js';
import { randomDemoTag } from './demo.js';
import {
  reconcile, buildIndex, resolveScan, normalizeTag, normalizeCode, compareLocation,
  STATUS, STATUS_ORDER, TAG_CONDITION, TAG_CONDITION_ORDER, RESULT
} from './reconcile.js';

const $ = id => document.getElementById(id);

const state = {
  assets: [],
  tags: [],
  rounds: [],
  round: null,
  scans: [],
  index: { byCode: new Map(), tagToCode: new Map() },
  report: null,
  lastScan: null,
  reportTab: 'missing',
  assetFilter: 'all',
  pendingCount: 0
};

let scanner;

// ---------------------------------------------------------------- เริ่มระบบ

init();

async function init() {
  scanner = new Scanner({
    onScan: handleScan,
    onStatus: s => { $('source-status').textContent = s.message; },
    onError: err => {
      $('source-status').textContent = err.message;
      toast(err.message);
    }
  });

  bindUi();
  await loadFromCache();
  renderAll();

  // ดึงข้อมูลใหม่แบบเงียบ ๆ ถ้าต่อเน็ตได้ เพื่อให้ทะเบียนตรงกับเซิร์ฟเวอร์
  if (isConfigured() && navigator.onLine) refresh({ silent: true });
  if (!isConfigured()) {
    showScreen('settings');
    toast('ตั้งค่าเซิร์ฟเวอร์ก่อนเริ่มใช้งาน หรือเปิดโหมดสาธิตเพื่อทดลอง');
  }

  window.addEventListener('online', () => { updateSyncChip(); flushQueue(); });
  window.addEventListener('offline', updateSyncChip);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // ใช้งานต่อได้แม้ลงทะเบียนไม่สำเร็จ เพียงแต่จะเปิดแบบออฟไลน์ไม่ได้
    });
  }
}

async function loadFromCache() {
  state.assets = await store.getAll('assets');
  state.tags = await store.getAll('tags');
  state.rounds = await store.getAll('rounds');
  state.index = buildIndex(state.assets, state.tags);

  const savedRoundId = await store.meta('currentRound');
  state.round = state.rounds.find(r => r.round_id === savedRoundId) || state.rounds[0] || null;
  if (state.round) state.scans = await store.scansOfRound(state.round.round_id);

  state.pendingCount = (await store.pendingScans()).length;
  recompute();
}

/** ดึงทะเบียนใหม่จากเซิร์ฟเวอร์ แล้วโหลดกลับเข้าหน่วยความจำ */
async function refresh({ silent = false } = {}) {
  try {
    await syncDown();
    await loadFromCache();
    renderAll();
    if (!silent) toast('ซิงก์ข้อมูลเรียบร้อย');
  } catch (err) {
    if (!silent) toast(err instanceof ApiError ? err.message : 'ซิงก์ไม่สำเร็จ');
  }
  updateSyncChip();
}

// ---------------------------------------------------------------- การสแกน

/**
 * รับผลจากเครื่องอ่านทุกชนิด
 * candidates ถูกลองทีละตัวจนกว่าจะพบในทะเบียน เพราะแท็ก NFC หนึ่งดวง
 * อาจให้ทั้งข้อความที่เขียนไว้ข้างในและเลขซีเรียล ซึ่งอาจผูกไว้คนละแบบ
 */
async function handleScan({ candidates, source, duplicate }) {
  if (!state.round) {
    toast('ยังไม่ได้เลือกวงรอบตรวจนับ');
    return;
  }

  let resolved = null;
  for (const candidate of candidates) {
    const r = resolveScan(candidate, state.index, state.round);
    if (r.result !== RESULT.UNKNOWN) { resolved = r; break; }
    resolved = resolved || r;
  }

  const cfg = getConfig();
  // ต้องเป็นการสแกน "ครั้งล่าสุด" ของชิ้นนี้ ไม่ใช่ครั้งแรก มิฉะนั้นการกดแก้เป็น
  // ชำรุดไว้แล้วจะถูกย้อนกลับเป็นสมบูรณ์เงียบ ๆ เมื่อเครื่องอ่านยิงซ้ำ
  const already = resolved.asset ? findLatestScanOf(resolved.asset.asset_code) : null;

  // เครื่อง UHF ยิงแท็กเดิมรัวเป็นสิบครั้งต่อวินาที ถ้าบันทึกทุกครั้งจะได้ขยะ
  // แต่ยังต้องแสดงผลบนจอ เพื่อให้ผู้ตรวจรู้ว่าเครื่องยังอ่านชิ้นนี้อยู่
  if (duplicate && already) {
    showResult(resolved, { repeated: true });
    return;
  }

  const scan = {
    client_scan_id: crypto.randomUUID(),
    round_id: state.round.round_id,
    tag_id: resolved.tag_id,
    asset_code: resolved.asset ? normalizeCode(resolved.asset.asset_code) : '',
    result: resolved.result,
    status: resolved.asset ? (already?.status || STATUS.COMPLETE) : '',
    tag_condition: resolved.asset ? (already?.tag_condition || TAG_CONDITION.COMPLETE) : '',
    scanned_location: cfg.defaultLocation || '',
    device: cfg.device,
    scanned_by: cfg.inspector,
    scanned_at: new Date().toISOString(),
    note: '',
    pending: 1
  };

  await store.put('scans', scan);
  state.scans.push(scan);
  state.lastScan = scan;
  state.pendingCount++;

  feedback(resolved.result);
  showResult(resolved, { repeated: Boolean(already) });
  // ผู้ตรวจอาจเลื่อนดูรายการที่สแกนไปแล้วอยู่ พอมีชิ้นใหม่เข้ามาต้องดึงสายตา
  // กลับมาที่การ์ดผล ไม่งั้นจะไม่เห็นว่าชิ้นที่เพิ่งยิงนั้นผ่านหรือมีปัญหา
  window.scrollTo({ top: 0, behavior: 'smooth' });
  recompute();
  renderScanScreen();
  renderReportScreen();
  scheduleFlush();

  // แท็กที่ยังไม่ผูกกับทรัพย์สินใด เปิดหน้าผูกให้ทันทีเพื่อไม่ให้ค้างไว้
  if (resolved.result === RESULT.UNKNOWN) openBindDialog(resolved.tag_id);
}

/** แก้สถานะของรายการที่เพิ่งสแกน โดยเขียนเป็นบรรทัดใหม่ — ผลล่าสุดชนะเสมอ */
async function amendLastScan(patch) {
  if (!state.lastScan || !state.lastScan.asset_code) return;

  const amended = {
    ...state.lastScan,
    ...patch,
    client_scan_id: crypto.randomUUID(),
    scanned_at: new Date().toISOString(),
    pending: 1
  };
  await store.put('scans', amended);
  state.scans.push(amended);
  state.lastScan = amended;
  state.pendingCount++;

  recompute();
  renderScanScreen();
  renderReportScreen();
  scheduleFlush();
  toast('บันทึกเป็น ' + (patch.status || patch.tag_condition) + ' แล้ว');
}

/** การสแกนล่าสุดของทรัพย์สินชิ้นหนึ่งในวงรอบปัจจุบัน */
function findLatestScanOf(assetCode) {
  const code = normalizeCode(assetCode);
  for (let i = state.scans.length - 1; i >= 0; i--) {
    if (normalizeCode(state.scans[i].asset_code) === code) return state.scans[i];
  }
  return null;
}

function recompute() {
  if (!state.round) { state.report = null; return; }
  state.report = reconcile(state.round, state.assets, state.tags, state.scans);
}

// ---------------------------------------------------------------- ส่งข้อมูลขึ้นเซิร์ฟเวอร์

let flushTimer = null;

/**
 * รวบผลสแกนส่งเป็นชุด ไม่ส่งทีละครั้ง
 * เพราะ Apps Script จำกัดจำนวนคำขอต่อวัน และการสแกนเกิดถี่มาก
 */
function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushQueue, 4000);
  updateSyncChip();
}

async function flushQueue() {
  if (!isConfigured() || !navigator.onLine) return updateSyncChip();
  try {
    const res = await syncUp();
    state.pendingCount = (await store.pendingScans()).length;
    if (res.remaining > 0) scheduleFlush(); // ยังมีค้างอยู่ ส่งชุดถัดไปต่อ
  } catch {
    // ส่งไม่สำเร็จไม่เป็นไร ข้อมูลยังอยู่ในคิว รอบหน้าค่อยลองใหม่
  }
  updateSyncChip();
}

// ---------------------------------------------------------------- การแสดงผล

function renderAll() {
  renderTopbar();
  renderScanScreen();
  renderReportScreen();
  renderAssetScreen();
  renderSettings();
  updateSyncChip();
}

function renderTopbar() {
  const cfg = getConfig();
  $('round-name').textContent = state.round ? state.round.name : 'ยังไม่ได้เลือกวงรอบ';
  const parts = [];
  if (cfg.defaultLocation) parts.push(cfg.defaultLocation);
  if (cfg.inspector) parts.push(cfg.inspector);
  if (state.round?.scope_type === 'location') parts.push('ขอบเขต: ' + state.round.scope_value);
  $('round-sub').textContent = parts.join(' · ') || 'ตั้งชื่อผู้ตรวจและสถานที่ได้ในหน้าตั้งค่า';
}

function showResult(resolved, { repeated = false } = {}) {
  const card = $('result-card');
  card.className = 'result-card';

  if (resolved.result === RESULT.FOUND) {
    card.classList.add(repeated ? 'is-duplicate' : 'is-found');
    $('result-icon').textContent = repeated ? '🔁' : '✅';
    $('result-title').textContent = repeated ? 'สแกนซ้ำ — นับไปแล้ว' : 'พบแล้ว';
    $('result-detail').textContent = resolved.asset.name;
    $('result-meta').textContent =
      `${resolved.asset.asset_code} · ${resolved.asset.location} · ${resolved.tag_id}`;
  } else if (resolved.result === RESULT.MISPLACED) {
    card.classList.add('is-misplaced');
    $('result-icon').textContent = '⚠️';
    $('result-title').textContent = 'อยู่ผิดที่';
    $('result-detail').textContent = resolved.asset.name;
    $('result-meta').textContent =
      `ทะเบียนระบุว่าอยู่ที่ ${resolved.asset.location} · ${resolved.asset.asset_code}`;
  } else {
    card.classList.add('is-unknown');
    $('result-icon').textContent = '❓';
    $('result-title').textContent = 'แท็กไม่รู้จัก';
    $('result-detail').textContent = 'ยังไม่ได้ผูกแท็กนี้กับทรัพย์สินใด';
    $('result-meta').textContent = resolved.tag_id;
  }

  $('amend').hidden = resolved.result === RESULT.UNKNOWN;
}

function renderScanScreen() {
  const s = state.report?.summary;
  $('stat-found').textContent = s?.found ?? 0;
  $('stat-missing').textContent = s?.missing ?? 0;
  $('stat-misplaced').textContent = s?.misplaced ?? 0;
  $('stat-unknown').textContent = s?.unknown ?? 0;
  $('progress-bar').style.width = (s?.percent ?? 0) + '%';
  $('progress-text').textContent = s
    ? `${s.found} / ${s.expected} รายการ (${s.percent}%)`
    : 'ยังไม่มีข้อมูลทะเบียน';

  renderChips($('amend-status'), STATUS_ORDER, state.lastScan?.status,
    v => amendLastScan({ status: v }));
  renderChips($('amend-tag'), TAG_CONDITION_ORDER, state.lastScan?.tag_condition,
    v => amendLastScan({ tag_condition: v }));

  // แสดงการสแกนล่าสุด 12 รายการ ใหม่สุดอยู่บน
  const recent = [...state.scans].reverse().slice(0, 12);
  renderList($('recent-list'), recent, scan => {
    const asset = state.index.byCode.get(normalizeCode(scan.asset_code));
    return {
      title: asset ? asset.name : 'แท็กไม่รู้จัก',
      sub: `${scan.tag_id} · ${timeOf(scan.scanned_at)}`,
      side: badgeFor(scan, asset),
      onClick: asset ? null : () => openBindDialog(scan.tag_id)
    };
  }, 'ยังไม่มีรายการที่สแกน');

  $('demo-scan').hidden = !getConfig().demo;
}

function renderReportScreen() {
  const r = state.report;
  if (!r) {
    $('summary-grid').innerHTML = '<p class="empty">ยังไม่ได้เลือกวงรอบตรวจนับ</p>';
    return;
  }

  const s = r.summary;
  $('summary-grid').innerHTML = [
    card(s.expected, 'ต้องตรวจทั้งหมด'),
    card(s.found, 'พบแล้ว'),
    card(s.missing, 'ยังไม่พบ'),
    card(s.misplaced + s.unknown, 'ผิดที่ / ไม่รู้จัก')
  ].join('');

  renderList($('location-list'), r.byLocation, g => ({
    title: g.location,
    sub: `${g.found} / ${g.expected} รายการ`,
    side: g.found >= g.expected
      ? '<span class="badge badge-ok">ครบ</span>'
      : `<span class="badge badge-mute">เหลือ ${g.expected - g.found}</span>`
  }), 'ยังไม่มีข้อมูล');

  const rows = {
    missing: r.missing.map(m => ({ asset: m.asset, scan: null })),
    found: r.found,
    misplaced: r.misplaced,
    unknown: r.unknown
  }[state.reportTab] || [];

  renderList($('report-list'), rows, row => {
    if (state.reportTab === 'unknown') {
      return {
        title: row.tag_id,
        sub: 'แท็กที่ยังไม่ผูกกับทรัพย์สิน · ' + timeOf(row.scan.scanned_at),
        side: '<span class="badge badge-info">ผูกแท็ก</span>',
        onClick: () => openBindDialog(row.tag_id)
      };
    }
    return {
      title: row.asset.name,
      sub: `${row.asset.asset_code} · ${row.asset.location}`,
      side: badgeFor(row.scan, row.asset)
    };
  }, 'ไม่มีรายการในกลุ่มนี้');
}

function renderAssetScreen() {
  const q = $('asset-search').value.trim().toLowerCase();
  const locations = [...new Set(state.assets.map(a => a.location).filter(Boolean))].sort(compareLocation);

  renderChips($('asset-filters'), ['all', ...locations], state.assetFilter, v => {
    state.assetFilter = v;
    renderAssetScreen();
  }, v => (v === 'all' ? 'ทั้งหมด' : v));

  // สร้างชุดรหัสที่ผูกแท็กแล้วครั้งเดียว แทนการไล่ค่าในแผนที่ซ้ำทุกแถว
  const boundCodes = new Set(state.index.tagToCode.values());

  const filtered = state.assets.filter(a => {
    if (state.assetFilter !== 'all' && a.location !== state.assetFilter) return false;
    if (!q) return true;
    return [a.name, a.asset_code, a.location].join(' ').toLowerCase().includes(q);
  }).slice(0, 200);

  renderList($('asset-list'), filtered, a => {
    const bound = boundCodes.has(normalizeCode(a.asset_code));
    return {
      title: a.name,
      sub: `${a.asset_code} · ${a.location} · ${a.item_type === 'inventory' ? 'สินค้าคงคลัง' : 'ทรัพย์สิน'}`,
      side: bound
        ? '<span class="badge badge-ok">มีแท็ก</span>'
        : '<span class="badge badge-warn">ยังไม่มีแท็ก</span>'
    };
  }, state.assets.length ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีทะเบียน — กดซิงก์ในหน้าตั้งค่า');
}

function renderSettings() {
  const cfg = getConfig();
  $('cfg-inspector').value = cfg.inspector;
  $('cfg-location').value = cfg.defaultLocation;
  $('cfg-device').value = cfg.device;
  $('cfg-endpoint').value = cfg.endpoint;
  $('cfg-key').value = cfg.accessKey;
  $('cfg-demo').checked = cfg.demo;
  $('cfg-beep').checked = cfg.beep;
  $('cfg-vibrate').checked = cfg.vibrate;

  $('location-options').innerHTML = [...new Set(state.assets.map(a => a.location).filter(Boolean))]
    .sort(compareLocation).map(l => `<option value="${escapeHtml(l)}">`).join('');

  $('cfg-round').innerHTML = state.rounds.length
    ? state.rounds.map(r =>
        `<option value="${escapeHtml(r.round_id)}"${r.round_id === state.round?.round_id ? ' selected' : ''}>${escapeHtml(r.name)}</option>`
      ).join('')
    : '<option value="">— ยังไม่มีวงรอบ —</option>';

  $('storage-hint').textContent =
    `ทะเบียน ${state.assets.length} รายการ · แท็กที่ผูกแล้ว ${state.tags.length} ดวง · รอส่งขึ้นเซิร์ฟเวอร์ ${state.pendingCount} รายการ`;
}

function updateSyncChip() {
  const chip = $('sync-chip');
  chip.classList.remove('is-online', 'is-pending');

  if (state.pendingCount > 0) {
    chip.classList.add('is-pending');
    $('sync-text').textContent = 'รอส่ง ' + state.pendingCount;
  } else if (navigator.onLine && isConfigured()) {
    chip.classList.add('is-online');
    $('sync-text').textContent = getConfig().demo ? 'สาธิต' : 'ซิงก์แล้ว';
  } else {
    $('sync-text').textContent = 'ออฟไลน์';
  }
}

// ---------------------------------------------------------------- ตัวช่วยแสดงผล

function card(value, label) {
  return `<div class="summary-card"><b>${value}</b><span>${escapeHtml(label)}</span></div>`;
}

function badgeFor(scan, asset) {
  if (!asset) return '<span class="badge badge-info">ไม่รู้จัก</span>';
  if (!scan) return '<span class="badge badge-mute">ยังไม่พบ</span>';
  if (scan.result === RESULT.MISPLACED) return '<span class="badge badge-warn">ผิดที่</span>';

  const cls = scan.status === STATUS.COMPLETE ? 'badge-ok' : 'badge-danger';
  const tag = scan.tag_condition && scan.tag_condition !== TAG_CONDITION.COMPLETE
    ? ` <span class="badge badge-warn">TAG ${escapeHtml(scan.tag_condition)}</span>`
    : '';
  return `<span class="badge ${cls}">${escapeHtml(scan.status || 'พบแล้ว')}</span>${tag}`;
}

function renderList(el, items, mapFn, emptyText) {
  if (!items.length) {
    el.innerHTML = `<li class="empty">${escapeHtml(emptyText)}</li>`;
    return;
  }
  el.innerHTML = '';
  items.forEach(item => {
    const view = mapFn(item);
    const li = document.createElement('li');
    const node = document.createElement(view.onClick ? 'button' : 'div');
    node.className = 'list-item';
    if (view.onClick) {
      node.type = 'button';
      node.addEventListener('click', view.onClick);
    }
    node.innerHTML =
      `<div class="list-main"><div class="list-title">${escapeHtml(view.title)}</div>` +
      `<div class="list-sub">${escapeHtml(view.sub)}</div></div>` +
      `<div class="list-side">${view.side || ''}</div>`;
    li.appendChild(node);
    el.appendChild(li);
  });
}

function renderChips(el, values, active, onPick, labelFn = v => v) {
  el.innerHTML = '';
  values.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (v === active ? ' is-active' : '');
    b.textContent = labelFn(v);
    b.addEventListener('click', () => onPick(v));
    el.appendChild(b);
  });
}

function timeOf(iso) {
  try {
    return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

/**
 * เสียงและแรงสั่นตอบรับ
 * ผู้ตรวจมองจอไม่ได้ตลอดเวลาเพราะต้องเล็งเครื่องอ่านไปที่ของ
 * เสียงต่างระดับจึงบอกผลได้โดยไม่ต้องละสายตา
 */
function feedback(result) {
  const cfg = getConfig();
  if (cfg.vibrate && navigator.vibrate) {
    navigator.vibrate(result === RESULT.FOUND ? 40 : [40, 60, 40]);
  }
  if (!cfg.beep) return;
  try {
    const ctx = feedback.ctx || (feedback.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = result === RESULT.FOUND ? 880 : result === RESULT.MISPLACED ? 590 : 380;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.16);
  } catch {
    // บางเบราว์เซอร์ห้ามเล่นเสียงก่อนผู้ใช้แตะจอ ปล่อยผ่านได้
  }
}

// ---------------------------------------------------------------- ผูกแท็ก

function openBindDialog(tagId) {
  $('bind-tag').textContent = tagId;
  $('bind-search').value = '';
  renderBindResults('');
  $('bind-dialog').showModal();
  $('bind-dialog').dataset.tag = tagId;
}

function renderBindResults(query) {
  const q = query.trim().toLowerCase();
  // ยังไม่พิมพ์อะไร ให้เสนอรายการที่ยังไม่พบในวงรอบนี้ก่อน เพราะมีโอกาสใช่ที่สุด
  const pool = q
    ? state.assets.filter(a => [a.name, a.asset_code, a.location].join(' ').toLowerCase().includes(q))
    : (state.report?.missing.map(m => m.asset) || state.assets);

  renderList($('bind-results'), pool.slice(0, 30), a => ({
    title: a.name,
    sub: `${a.asset_code} · ${a.location}`,
    side: '',
    onClick: () => bindTag($('bind-dialog').dataset.tag, a)
  }), 'ไม่พบรายการที่ค้นหา');
}

async function bindTag(tagId, asset) {
  const code = normalizeCode(asset.asset_code);
  try {
    await api.bindTag({
      tag_id: tagId,
      asset_code: code,
      tag_type: guessTagType(tagId),
      actor: getConfig().inspector
    });
  } catch (err) {
    toast('ผูกแท็กบนเซิร์ฟเวอร์ไม่สำเร็จ — บันทึกไว้ในเครื่องก่อน');
  }

  // ผูกในเครื่องทันทีไม่ว่าเซิร์ฟเวอร์จะสำเร็จหรือไม่ เพื่อให้สแกนต่อได้เลย
  const record = { tag_id: normalizeTag(tagId), asset_code: code, tag_type: guessTagType(tagId), active: 'TRUE' };
  await store.put('tags', record);
  state.tags = state.tags.filter(t => normalizeTag(t.tag_id) !== normalizeTag(tagId)).concat(record);
  state.index = buildIndex(state.assets, state.tags);

  $('bind-dialog').close();
  toast('ผูกแท็กกับ ' + asset.name + ' แล้ว');

  recompute();
  renderScanScreen();
  renderReportScreen();
  renderAssetScreen();
}

/** เดาชนิดแท็กจากรูปแบบรหัส ใช้เก็บสถิติว่าใช้อุปกรณ์อ่านแบบใดมากที่สุด */
function guessTagType(tagId) {
  const t = normalizeTag(tagId);
  if (/^E[0-9A-F]{15,}$/.test(t)) return 'uhf';   // EPC ของ UHF ขึ้นต้นด้วย E2/E28
  if (/^[0-9A-F]{8,20}$/.test(t)) return 'nfc';
  return 'manual';
}

// ---------------------------------------------------------------- ส่งออกรายงาน

/**
 * ส่งออกเป็น CSV ที่เปิดใน Excel ภาษาไทยได้ทันที
 * ต้องมี BOM นำหน้า มิฉะนั้น Excel บน Windows จะอ่านภาษาไทยเป็นอักขระเพี้ยน
 */
function exportCsv() {
  const r = state.report;
  if (!r) return toast('ยังไม่มีข้อมูลให้ส่งออก');

  const header = ['ลำดับที่', 'ชื่อรายการ', 'รหัส', 'ประเภท', 'สถานที่ตามทะเบียน',
    'จำนวน', 'หน่วย', 'ผลการตรวจนับ', 'สถานะ', 'ความสมบูรณ์ของ TAG',
    'สถานที่ที่สแกนได้', 'ผู้ตรวจ', 'เวลาที่สแกน', 'หมายเหตุ'];

  const lines = [];
  const push = (asset, scan, resultLabel) => lines.push([
    asset?.seq || '', asset?.name || '', asset?.asset_code || scan?.tag_id || '',
    asset?.item_type === 'inventory' ? 'สินค้าคงคลัง' : 'ทรัพย์สิน',
    asset?.location || '', asset?.qty || '', asset?.unit || '',
    resultLabel, scan?.status || '', scan?.tag_condition || '',
    scan?.scanned_location || '', scan?.scanned_by || '',
    scan?.scanned_at ? new Date(scan.scanned_at).toLocaleString('th-TH') : '',
    scan?.note || asset?.note || ''
  ]);

  r.found.forEach(f => push(f.asset, f.scan, 'พบ'));
  r.missing.forEach(m => push(m.asset, null, 'ไม่พบ'));
  r.misplaced.forEach(m => push(m.asset, m.scan, 'อยู่ผิดที่'));
  r.unknown.forEach(u => push(null, u.scan, 'แท็กไม่รู้จัก'));

  const csv = [header, ...lines]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const name = `ตรวจนับ-${state.round?.name || 'รายงาน'}-${new Date().toISOString().slice(0, 10)}.csv`;
  download('﻿' + csv, name, 'text/csv;charset=utf-8');
}

function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function summaryText() {
  const r = state.report;
  if (!r) return '';
  const s = r.summary;
  const lines = [
    `สรุปการตรวจนับ — ${state.round.name}`,
    `ผู้ตรวจ ${getConfig().inspector || '-'} · ${new Date().toLocaleString('th-TH')}`,
    '',
    `ต้องตรวจทั้งหมด ${s.expected} รายการ`,
    `พบแล้ว ${s.found} (${s.percent}%)`,
    `ยังไม่พบ ${s.missing}`,
    `อยู่ผิดที่ ${s.misplaced}`,
    `แท็กไม่รู้จัก ${s.unknown}`,
    ''
  ];
  STATUS_ORDER.forEach(k => {
    if (r.byStatus[k]) lines.push(`สถานะ ${k}: ${r.byStatus[k]}`);
  });
  TAG_CONDITION_ORDER.forEach(k => {
    if (r.byTagCondition[k]) lines.push(`TAG ${k}: ${r.byTagCondition[k]}`);
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------- เชื่อมอีเวนต์

function bindUi() {
  document.querySelectorAll('.tabbar-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  document.querySelectorAll('.stat').forEach(btn => {
    btn.addEventListener('click', () => {
      state.reportTab = btn.dataset.goto;
      showScreen('report');
      renderReportScreen();
      syncReportTabs();
    });
  });

  document.querySelectorAll('#report-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.reportTab = tab.dataset.tab;
      syncReportTabs();
      renderReportScreen();
    });
  });

  renderSourceChips();

  $('manual-form').addEventListener('submit', e => {
    e.preventDefault();
    const value = $('manual-input').value.trim();
    if (!value) return;
    $('manual-input').value = '';
    scanner.submitManual(value);
  });

  $('demo-scan').addEventListener('click', () => scanner.submitManual(randomDemoTag()));
  $('asset-search').addEventListener('input', renderAssetScreen);
  $('bind-search').addEventListener('input', e => renderBindResults(e.target.value));
  $('export-csv').addEventListener('click', exportCsv);
  $('copy-summary').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      toast('คัดลอกสรุปแล้ว');
    } catch {
      toast('คัดลอกไม่สำเร็จ');
    }
  });

  $('sync-chip').addEventListener('click', () => { flushQueue(); refresh(); });
  $('sync-now').addEventListener('click', () => { flushQueue(); refresh(); });

  $('test-connection').addEventListener('click', async () => {
    try {
      const res = await api.ping();
      toast('เชื่อมต่อสำเร็จ — ' + res.sheet);
    } catch (err) {
      toast(err.message);
    }
  });

  $('new-round').addEventListener('click', createRound);

  $('cfg-round').addEventListener('change', async e => {
    state.round = state.rounds.find(r => r.round_id === e.target.value) || null;
    await store.meta('currentRound', state.round?.round_id || '');
    state.scans = state.round ? await store.scansOfRound(state.round.round_id) : [];
    state.lastScan = null;
    recompute();
    renderAll();
  });

  // ค่าตั้งทุกช่องบันทึกทันทีที่แก้ ผู้ใช้จะได้ไม่ต้องหาปุ่มบันทึก
  const bindField = (id, key, prop = 'value') => {
    $(id).addEventListener('change', e => {
      saveConfig({ [key]: e.target[prop] });
      renderTopbar();
      updateSyncChip();
      if (key === 'demo') refresh();
    });
  };
  bindField('cfg-inspector', 'inspector');
  bindField('cfg-location', 'defaultLocation');
  bindField('cfg-device', 'device');
  bindField('cfg-endpoint', 'endpoint');
  bindField('cfg-key', 'accessKey');
  bindField('cfg-demo', 'demo', 'checked');
  bindField('cfg-beep', 'beep', 'checked');
  bindField('cfg-vibrate', 'vibrate', 'checked');
}

/** แสดงเฉพาะวิธีอ่านที่เครื่องนี้ทำได้จริง เพื่อไม่ให้ผู้ใช้กดแล้วเจอข้อความผิดพลาด */
function renderSourceChips() {
  const caps = capabilities();
  const sources = [
    ['hid', 'เครื่องอ่านบลูทูธ', caps.hid],
    ['nfc', 'NFC ในมือถือ', caps.nfc],
    ['camera', 'บาร์โค้ด/QR', caps.camera],
    ['manual', 'พิมพ์เอง', true]
  ];

  const el = $('source-chips');
  el.innerHTML = '';
  sources.forEach(([key, label, enabled]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.disabled = !enabled;
    if (!enabled) b.title = 'เครื่องนี้ไม่รองรับวิธีนี้';
    b.addEventListener('click', async () => {
      [...el.children].forEach(c => c.classList.remove('is-active'));
      b.classList.add('is-active');
      $('camera-view').hidden = key !== 'camera';
      await scanner.start(key);
      saveConfig({ scanSource: key });
    });
    el.appendChild(b);
  });
}

function syncReportTabs() {
  document.querySelectorAll('#report-tabs .tab').forEach(t => {
    t.classList.toggle('is-active', t.dataset.tab === state.reportTab);
  });
}

async function createRound() {
  const period = new Date().toISOString().slice(0, 7);
  try {
    const { round } = await api.createRound({ period, actor: getConfig().inspector });
    await store.put('rounds', round);
    state.rounds = await store.getAll('rounds');
    state.round = round;
    await store.meta('currentRound', round.round_id);
    state.scans = [];
    state.lastScan = null;
    recompute();
    renderAll();
    toast('เปิดวงรอบ ' + round.name + ' แล้ว');
  } catch (err) {
    toast(err.message);
  }
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.hidden = s.dataset.screen !== name;
  });
  document.querySelectorAll('.tabbar-btn').forEach(b => {
    b.classList.toggle('is-active', b.dataset.screen === name);
  });
  // ปิดกล้องเมื่อออกจากหน้าสแกน ไม่งั้นไฟกล้องค้างและเปลืองแบตเตอรี่
  if (name !== 'scan' && scanner.source === 'camera') {
    scanner.stop();
    $('camera-view').hidden = true;
  }
  window.scrollTo(0, 0);
}

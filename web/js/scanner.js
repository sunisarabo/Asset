/**
 * scanner.js — รับรหัสแท็กจากอุปกรณ์อ่านทุกแบบ แล้วส่งออกเป็นเหตุการณ์เดียวกัน
 *
 * มือถืออ่าน RFID ได้ไม่ทุกชนิด จึงต้องรองรับหลายทางพร้อมกัน
 *
 *   nfc    — แท็ก NFC/HF 13.56MHz อ่านตรงจากมือถือ Android ผ่าน Web NFC
 *   hid    — เครื่องอ่าน UHF ต่อบลูทูธในโหมดคีย์บอร์ด ครอบคลุมแท็ก UHF ส่วนใหญ่
 *   camera — บาร์โค้ด/QR สำรองไว้ใช้เมื่อแท็ก RFID ชำรุดจนอ่านไม่ได้
 *   manual — พิมพ์รหัสเอง ใช้เมื่อแท็กหายทั้งดวง
 *
 * ทุกทางส่งออกเป็น { candidates, source } โดย candidates เรียงจากค่าที่
 * น่าจะใช่ที่สุดไปหาน้อยที่สุด ผู้เรียกลองเทียบทีละตัวจนกว่าจะพบในทะเบียน
 */

const HID_IDLE_MS = 120;   // เครื่องอ่านบางรุ่นไม่ส่ง Enter ปิดท้าย จึงต้องตัดด้วยเวลาว่าง
const DEDUPE_MS = 2000;    // เครื่อง UHF ยิงแท็กเดิมซ้ำหลายครั้งต่อวินาที

export function capabilities() {
  return {
    nfc: 'NDEFReader' in window,
    camera: 'BarcodeDetector' in window && Boolean(navigator.mediaDevices?.getUserMedia),
    hid: true,     // ใช้ได้เสมอ เพราะเป็นการรับอินพุตคีย์บอร์ด
    manual: true
  };
}

export class Scanner {
  constructor({ onScan, onStatus, onError } = {}) {
    this.onScan = onScan || (() => {});
    this.onStatus = onStatus || (() => {});
    this.onError = onError || (() => {});

    this.source = null;
    this.lastSeen = new Map();
    this._hid = { buffer: '', timer: null };
    this._nfc = null;
    this._camera = null;

    this._onKeyDown = this._onKeyDown.bind(this);
  }

  /** ส่งผลออกไป พร้อมทำเครื่องหมายว่าเป็นการยิงซ้ำของแท็กเดิมหรือไม่ */
  emit(candidates, source) {
    const list = candidates.map(c => String(c || '').trim()).filter(Boolean);
    if (!list.length) return;

    const now = Date.now();
    const key = list[0].toUpperCase();
    const prev = this.lastSeen.get(key) || 0;
    const duplicate = now - prev < DEDUPE_MS;
    this.lastSeen.set(key, now);

    this.onScan({ candidates: list, source, duplicate, at: new Date().toISOString() });
  }

  async start(source) {
    await this.stop();
    this.source = source;

    if (source === 'nfc') return this._startNfc();
    if (source === 'camera') return this._startCamera();
    if (source === 'hid') return this._startHid();
    // manual ไม่ต้องเปิดอุปกรณ์อะไร รอผู้ใช้กดส่งจากฟอร์ม
    this.onStatus({ source, state: 'ready', message: 'พิมพ์รหัสแล้วกดบันทึก' });
  }

  async stop() {
    window.removeEventListener('keydown', this._onKeyDown, true);
    clearTimeout(this._hid.timer);
    this._hid.buffer = '';

    if (this._nfc?.controller) {
      this._nfc.controller.abort();
      this._nfc = null;
    }
    if (this._camera) {
      this._camera.stopped = true;
      this._camera.stream?.getTracks().forEach(t => t.stop());
      this._camera = null;
    }
    this.source = null;
  }

  // ---- NFC ----

  async _startNfc() {
    if (!('NDEFReader' in window)) {
      return this.onError(new Error(
        'เครื่องนี้อ่าน NFC ผ่านเว็บไม่ได้ — ต้องใช้ Android + Chrome และเปิด NFC ในตั้งค่าเครื่อง'
      ));
    }
    try {
      const reader = new NDEFReader();
      const controller = new AbortController();
      this._nfc = { reader, controller };

      reader.onreading = ({ serialNumber, message }) => {
        // ลำดับความสำคัญ: ข้อความในแท็ก (มักเขียนรหัสทรัพย์สินไว้) แล้วค่อยเลขซีเรียล
        const candidates = [...readNdefText(message), serialNumber];
        this.emit(candidates, 'nfc');
      };
      reader.onreadingerror = () => this.onError(new Error('อ่านแท็กไม่สำเร็จ ลองแตะใหม่อีกครั้ง'));

      await reader.scan({ signal: controller.signal });
      this.onStatus({ source: 'nfc', state: 'scanning', message: 'แตะแท็กที่ด้านหลังเครื่อง' });
    } catch (err) {
      // ผู้ใช้ปฏิเสธสิทธิ์ หรือหน้าเว็บไม่ได้เปิดผ่าน HTTPS
      this.onError(new Error('เปิด NFC ไม่สำเร็จ: ' + err.message));
    }
  }

  // ---- เครื่องอ่านบลูทูธโหมดคีย์บอร์ด ----

  _startHid() {
    // ดักที่ระดับ window เพื่อไม่ต้องโฟกัสช่องกรอก
    // ซึ่งจะทำให้คีย์บอร์ดบนจอเด้งขึ้นมาบังหน้าจอสแกน
    window.addEventListener('keydown', this._onKeyDown, true);
    this.onStatus({
      source: 'hid',
      state: 'scanning',
      message: 'พร้อมรับจากเครื่องอ่าน — กดไกที่เครื่องอ่านได้เลย'
    });
  }

  _onKeyDown(e) {
    // อย่าขโมยคีย์ขณะผู้ใช้กำลังพิมพ์ในช่องกรอก
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      this._flushHid();
      return;
    }
    if (e.key.length !== 1) return; // ข้ามปุ่มควบคุมอย่าง Shift หรือ F1

    this._hid.buffer += e.key;
    clearTimeout(this._hid.timer);
    this._hid.timer = setTimeout(() => this._flushHid(), HID_IDLE_MS);
  }

  _flushHid() {
    clearTimeout(this._hid.timer);
    const value = this._hid.buffer.trim();
    this._hid.buffer = '';
    // สั้นกว่า 4 ตัวมักเป็นการกดปุ่มพลาด ไม่ใช่รหัสแท็กจริง
    if (value.length >= 4) this.emit([value], 'hid');
  }

  // ---- กล้อง (บาร์โค้ด/QR) ----

  async _startCamera(videoEl) {
    const video = videoEl || document.getElementById('camera-view');
    if (!('BarcodeDetector' in window)) {
      return this.onError(new Error('เครื่องนี้ไม่รองรับการอ่านบาร์โค้ดผ่านกล้อง'));
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      const detector = new BarcodeDetector({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'data_matrix']
      });
      const state = { stream, stopped: false };
      this._camera = state;

      video.srcObject = stream;
      await video.play();
      this.onStatus({ source: 'camera', state: 'scanning', message: 'เล็งกล้องไปที่บาร์โค้ด' });

      const tick = async () => {
        if (state.stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) this.emit([codes[0].rawValue], 'camera');
        } catch {
          // เฟรมที่อ่านไม่ได้เป็นเรื่องปกติ ปล่อยผ่านแล้วลองเฟรมถัดไป
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch (err) {
      this.onError(new Error('เปิดกล้องไม่สำเร็จ: ' + err.message));
    }
  }

  /** ป้อนค่าด้วยมือ หรือจากปุ่มสาธิต ให้เดินผ่านเส้นทางเดียวกับการสแกนจริง */
  submitManual(value) {
    this.emit([value], this.source === 'manual' ? 'manual' : (this.source || 'manual'));
  }
}

/** ดึงข้อความจากเรคคอร์ด NDEF ทุกตัวที่ถอดเป็นตัวอักษรได้ */
function readNdefText(message) {
  const out = [];
  if (!message?.records) return out;
  for (const record of message.records) {
    try {
      if (record.recordType === 'text') {
        out.push(new TextDecoder(record.encoding || 'utf-8').decode(record.data));
      } else if (record.recordType === 'url') {
        out.push(new TextDecoder().decode(record.data));
      }
    } catch {
      // เรคคอร์ดที่ถอดไม่ได้ข้ามไป ยังมีเลขซีเรียลเป็นตัวสำรองอยู่
    }
  }
  return out;
}

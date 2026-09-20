/**
 * store.js — ที่เก็บข้อมูลบนเครื่อง (IndexedDB)
 *
 * การตรวจนับเกิดในห้องเก็บของและพื้นที่หวงห้ามที่สัญญาณมักไม่ถึง
 * แอปจึงต้องทำงานได้เต็มรูปแบบขณะออฟไลน์ ข้อมูลทะเบียนถูกดึงมาเก็บไว้ทั้งชุด
 * และผลสแกนถูกคิวไว้ที่นี่จนกว่าจะส่งขึ้นเซิร์ฟเวอร์สำเร็จ
 */

const DB_NAME = 'asset-audit';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // สำเนาทะเบียนจากเซิร์ฟเวอร์ ใช้ค้นหาและเทียบผลขณะออฟไลน์
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'asset_code' });
      }
      if (!db.objectStoreNames.contains('tags')) {
        db.createObjectStore('tags', { keyPath: 'tag_id' });
      }
      if (!db.objectStoreNames.contains('rounds')) {
        db.createObjectStore('rounds', { keyPath: 'round_id' });
      }
      // ผลสแกนทั้งหมด มี index บอกว่าส่งขึ้นเซิร์ฟเวอร์แล้วหรือยัง
      if (!db.objectStoreNames.contains('scans')) {
        const s = db.createObjectStore('scans', { keyPath: 'client_scan_id' });
        s.createIndex('by_round', 'round_id');
        s.createIndex('by_pending', 'pending');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && result.__value !== undefined ? result.__value : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function req(request) {
  const box = { __value: undefined };
  request.onsuccess = () => { box.__value = request.result; };
  return box;
}

export const store = {
  getAll(name) {
    return tx(name, 'readonly', s => req(s.getAll()));
  },

  get(name, key) {
    return tx(name, 'readonly', s => req(s.get(key)));
  },

  put(name, value) {
    return tx(name, 'readwrite', s => { s.put(value); });
  },

  /** เขียนทับทั้ง store — ใช้ตอนดึงทะเบียนชุดใหม่จากเซิร์ฟเวอร์ */
  replaceAll(name, values) {
    return tx(name, 'readwrite', s => {
      s.clear();
      values.forEach(v => s.put(v));
    });
  },

  /** ผลสแกนที่ยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ */
  pendingScans() {
    return tx('scans', 'readonly', s => req(s.index('by_pending').getAll(1)));
  },

  scansOfRound(roundId) {
    return tx('scans', 'readonly', s => req(s.index('by_round').getAll(roundId)));
  },

  markSynced(ids) {
    return tx('scans', 'readwrite', s => {
      ids.forEach(id => {
        const r = s.get(id);
        r.onsuccess = () => {
          const v = r.result;
          if (!v) return;
          v.pending = 0;
          s.put(v);
        };
      });
    });
  },

  async meta(key, value) {
    if (value === undefined) {
      const row = await tx('meta', 'readonly', s => req(s.get(key)));
      return row ? row.value : undefined;
    }
    return tx('meta', 'readwrite', s => { s.put({ key, value }); });
  }
};

/**
 * demo.js — ข้อมูลจำลองสำหรับโหมดสาธิต
 *
 * ใช้รายการจริงบางส่วนจากทะเบียนแผนกการโดยสาร เพื่อให้หน้าจอและรายงาน
 * มีหน้าตาเหมือนใช้งานจริง ทดลองสแกนได้โดยยังไม่ต้องติดตั้ง backend
 * แท็กในชุดนี้เป็นรหัสสมมุติ สแกนด้วยปุ่ม "สุ่มแท็กสาธิต" ในหน้าสแกน
 */

const ITEMS = [
  ['10020012', 'asset', 'Notebook HP-Amonsak Rungruangsri-HKTPS-N0044', 'DOM LL 02', 'เครื่อง'],
  ['10021937', 'asset', 'คอมพิวเตอร์ All In One Lenovo ThinkCentre M90a', 'DOM LL 02', 'เครื่อง'],
  ['10013338', 'asset', 'ถังดับเพลิง ขนาด 10 ปอนด์', 'DOM LL 02', 'ถัง'],
  ['10013577', 'asset', 'เก้าอี้พลาสติก OP', 'DOM LL 02', 'ตัว'],
  ['10013023', 'asset', 'โต๊ะพับอเนกประสงค์', 'DOM LL 02', 'ตัว'],
  ['10013233', 'asset', "Monitor 19.5'' ACER EH200Qbi", 'ROW C ROW G ROW J', 'เครื่อง'],
  ['10013224', 'asset', 'PC Asus S500SD-312100003WS', 'ROW C ROW G ROW J', 'เครื่อง'],
  ['10013225', 'asset', 'PC Asus S500SD-312100003WS', 'ROW C ROW G ROW J', 'เครื่อง'],
  ['10013393', 'asset', "UPS 800VA 'ETECH' Ego", 'ROW C ROW G ROW J', 'เครื่อง'],
  ['10021590', 'asset', 'คอมพิวเตอร์ Mini PC 3V0Q874', 'ROW C ROW G ROW J', 'เครื่อง'],
  ['10014136', 'asset', 'ป้ายทางออกหนีไฟ', 'ห้อง ADI301', 'แผ่น'],
  ['10014128', 'asset', 'โคมไฟฉุกเฉิน', 'ห้อง ADI301', 'รายการ'],
  ['10021696', 'asset', 'IPAD A16 (WIFI) 256 GB Silver', 'ห้อง IT101', 'เครื่อง'],
  ['10021697', 'asset', 'IPAD A16 (WIFI) 256 GB Silver', 'ห้อง IT101', 'เครื่อง'],
  ['10014726', 'asset', 'เครื่องทำลายเอกสาร ดำ GBC X415', 'ห้อง IT101', 'เครื่อง'],
  ['10017578', 'asset', 'โต๊ะสำนักงาน', 'ห้อง IT101', 'ตัว'],
  ['10013533', 'asset', 'ชั้นเหล็ก 4 ชั้น', 'ห้อง IT113', 'ใบ'],
  ['10017583', 'asset', 'ตู้เหล็กบานเปิดชั้นวาง 8 ช่อง', 'ห้อง IT113', 'ใบ'],
  ['10021730', 'inventory', 'Monitor Acer 27 นิ้ว', 'DOM LL 02', ''],
  ['10022142', 'inventory', 'UPS 1000VA ETECH ICT', 'ROW C ROW G ROW J', ''],
  ['10020146', 'inventory', 'ชั้นวางรองเท้า', 'ห้อง IT101', ''],
  ['10022916', 'inventory', 'Router 4G TP-LINK', 'ห้อง IT213', ''],
  ['10023153', 'inventory', 'UPS 850VA ETECH Thor', 'ห้อง IT213', ''],
  ['10021540', 'inventory', 'เก้าอี้ทำงานรุ่น Friendly สีดำ', 'ห้อง IT118', ''],
  ['10018449', 'inventory', 'เก้าอี้ตาข่าย 625B', 'ห้อง PB102', '']
];

/** สร้างรหัสแท็ก UHF สมมุติจากรหัสทรัพย์สิน ให้ผลเหมือนเดิมทุกครั้งที่เรียก */
export function demoTagFor(assetCode) {
  return 'E2801160' + String(assetCode).padStart(8, '0');
}

export function demoData() {
  const assets = ITEMS.map(([code, type, name, location, unit], i) => ({
    asset_code: code,
    item_type: type,
    seq: String(i + 1),
    name,
    location,
    qty: '1',
    unit,
    status: 'สมบูรณ์',
    tag_condition: type === 'asset' ? 'สมบูรณ์' : '',
    note: '',
    active: 'TRUE'
  }));

  // เว้นสองรายการสุดท้ายไว้ไม่ผูกแท็ก เพื่อให้ทดลองหน้าผูกแท็กได้
  const tags = assets.slice(0, -2).map(a => ({
    tag_id: demoTagFor(a.asset_code),
    asset_code: a.asset_code,
    tag_type: 'uhf',
    active: 'TRUE'
  }));

  const period = new Date().toISOString().slice(0, 7);
  return {
    assets,
    tags,
    rounds: [{
      round_id: 'demo-round',
      name: 'วงรอบสาธิต',
      period,
      scope_type: 'all',
      scope_value: '',
      status: 'open'
    }],
    options: {
      status: ['สมบูรณ์', 'ชำรุด', 'สูญหาย', 'เตรียมโอนย้าย', 'เตรียมจำหน่าย', 'ส่งซ่อม', 'อื่นๆ'],
      tag_condition: ['สมบูรณ์', 'ชำรุด', 'สูญหาย'],
      locations: [...new Set(assets.map(a => a.location))].sort()
    },
    server_time: new Date().toISOString()
  };
}

/** สุ่มแท็กจากชุดสาธิต รวมแท็กแปลกปลอมด้วย เพื่อให้เห็นผล "ไม่รู้จัก" */
export function randomDemoTag() {
  if (Math.random() < 0.12) return 'E2009A70' + Math.floor(Math.random() * 1e8).toString().padStart(8, '0');
  const pick = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  return demoTagFor(pick[0]);
}

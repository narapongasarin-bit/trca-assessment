/**
 * Code.gs — ปลายทางรับข้อมูลของระบบ TRCA (รุ่นเครื่องมือ TRCA-PROSE-20261007-R1)
 * ใช้กับ Google Apps Script ผูกกับ Google Sheet หนึ่งไฟล์
 *
 * วิธีติดตั้ง
 *  1. สร้าง Google Sheet ใหม่ ตั้งชื่อว่า TRCA_Responses
 *  2. เมนู ส่วนขยาย > Apps Script  แล้ววางไฟล์นี้ทับโค้ดเดิมทั้งหมด
 *  3. กด Deploy > New deployment > เลือกชนิด Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. คัดลอก Web app URL ไปวางที่ endpoint ในไฟล์ config.js (ไฟล์ตั้งค่าไฟล์เดียวของเว็บ)
 *  5. รัน setupSheets() หนึ่งครั้งเพื่อสร้างหัวตาราง
 *
 * การอัปเดตโค้ดนี้ภายหลัง: วางทับแล้ว Deploy > Manage deployments > ไอคอนดินสอ > Version: New version > Deploy
 * ลิงก์ Web app เดิมยังใช้ได้ ไม่ต้องแก้ config.js
 *
 * หมายเหตุด้านความปลอดภัย
 *  - ตั้ง Who has access เป็น Anyone เพราะครูผู้ตอบไม่ได้ล็อกอินบัญชี Google
 *  - ระบบไม่เก็บชื่อ นามสกุล หรือชื่อโรงเรียน จึงไม่มีข้อมูลระบุตัวบุคคลในชีต
 *  - หากต้องการกันการส่งซ้ำหรือการส่งจากภายนอก ให้ตั้งค่า SHARED_TOKEN แล้วส่งค่าเดียวกันจากหน้าเว็บ
 */

var SHARED_TOKEN = '';                 // เว้นว่าง = ไม่ตรวจ  ถ้าตั้งค่าต้องส่ง token มาด้วย

// รุ่นเครื่องมือที่รับข้อมูล ต้องตรงกับ INSTRUMENT_VERSION ใน js/items.js
// หากไม่ตรง ระบบปฏิเสธการบันทึก เพื่อไม่ให้คำตอบจากข้อคำถามต่างรุ่นถูกรวมเป็นชุดเดียวกัน
var ACCEPTED_INSTRUMENT = 'TRCA-PROSE-20261007-R1';

var SHEET_RAW    = 'Raw';              // หมายเลขตัวเลือกดิบ 1–4
var SHEET_SCORED = 'TRCA_Data';        // คะแนน โครงสร้างเดียวกับไฟล์ข้อมูลจำลอง
var SHEET_PERSON = 'Person_Info';      // ข้อมูลทั่วไปและสรุปข้อมูลขาดหาย
var SHEET_CONFLICT = 'Conflicts';      // กรณีรหัสซ้ำข้ามคน เก็บไว้ตรวจสอบ ไม่เขียนทับของเดิม
var SHEET_RESULTS   = 'Results';       // ผลวิเคราะห์รายบุคคล ผู้วิจัยกรอกเองหลังวิเคราะห์ด้วย ConQuest เสร็จ
var SHEET_CONFIG    = 'Config';        // สวิตช์ ResultsPublished คุมว่าจะให้ครูตรวจผลได้หรือยัง

function itemCodes_() {
  var c = [];
  for (var i = 1; i <= 28; i++) c.push('K' + ('0' + i).slice(-2));
  for (var i = 1; i <= 20; i++) c.push('S' + ('0' + i).slice(-2));
  for (var i = 1; i <= 20; i++) c.push('A' + ('0' + i).slice(-2));
  return c;
}

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var codes = itemCodes_();
  ensure_(ss, SHEET_SCORED, ['ID'].concat(codes));
  ensure_(ss, SHEET_RAW,    ['ID', 'session', 'submittedAt', 'durationSec', 'appVersion', 'Instrument'].concat(codes));
  ensure_(ss, SHEET_CONFLICT, ['ID', 'session', 'submittedAt', 'note'].concat(codes));
  ensure_(ss, SHEET_RESULTS, ['ID', 'Theta_K', 'SE_K', 'T_K', 'Level_K',
                              'Theta_S', 'SE_S', 'T_S', 'Level_S',
                              'Theta_A', 'SE_A', 'T_A', 'Level_A', 'Note']);
  var cfg = ensure_(ss, SHEET_CONFIG, ['Key', 'Value', 'หมายเหตุ']);
  if (cfg.getLastRow() < 2) {
    cfg.appendRow(['ResultsPublished', 'FALSE',
      'เปลี่ยนเป็น TRUE เมื่อวิเคราะห์และกรอกชีต Results ครบแล้ว จึงจะให้ครูตรวจผลได้']);
  }
  ensure_(ss, SHEET_PERSON, ['ID', 'startedAt', 'submittedAt', 'consent', 'sex', 'vt', 'yrs', 'sz', 'grade', 'ex',
                             'durationSec', 'Instrument']);
}

function ensure_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#25486D').setFontColor('#FFFFFF');
    sh.setFrozenRows(1); sh.setFrozenColumns(1);
  }
  return sh;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var p = JSON.parse(e.postData.contents);
    if (SHARED_TOKEN && p.token !== SHARED_TOKEN) return json_({ ok: false, error: 'token ไม่ถูกต้อง' });
    if (!p.id) return json_({ ok: false, error: 'ไม่มีรหัสผู้ตอบ' });

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    setupSheets();

    if (p.action === 'checkResult') return handleCheckResult_(ss, p.id);

    // ---------- ตรวจรุ่นเครื่องมือ ----------
    if (p.instrument !== ACCEPTED_INSTRUMENT) {
      return json_({ ok: false, error: 'แบบประเมินที่เปิดอยู่เป็นฉบับเก่า กรุณารีเฟรชหน้าเว็บ (Ctrl+Shift+R) แล้วทำใหม่ '
        + 'คำตอบฉบับเก่ารวมกับฉบับปัจจุบันไม่ได้ ข้อมูลของท่านยังอยู่ในเครื่อง และบันทึกเป็นไฟล์ได้' });
    }

    var codes = itemCodes_();

    // ---------- ตรวจความครบถ้วนและรูปแบบของคำตอบดิบ ----------
    // ทุกข้อต้องตอบ 1–4 ไม่มีตัวเลือกไม่ประสงค์ตอบ และคะแนนต้องสอดคล้องกับคำตอบ
    var raw = p.raw || {}, sc = p.scored || {}, missing = [], badVal = [], badScore = [], oldD = [];
    codes.forEach(function (c) {
      var v = raw[c];
      if (v === undefined || v === null || v === '') { missing.push(c); return; }
      if (v === 'D' || v === 'M') { oldD.push(c); return; }            // ค่าจากหน้าเว็บรุ่นเก่าที่เคยมีปุ่มไม่ประสงค์ตอบ
      if ([1, 2, 3, 4].indexOf(Number(v)) < 0) { badVal.push(c); return; }
      var mx = c.charAt(0) === 'K' ? 1 : 3, k = sc[c];
      if (k === null || k === undefined || k === '' || Number(k) !== Math.floor(Number(k)) || Number(k) < 0 || Number(k) > mx) badScore.push(c);
    });
    if (oldD.length) {
      return json_({ ok: false, error: 'ทุกข้อต้องตอบ ข้อ ' + oldD.slice(0, 5).join(', ') + (oldD.length > 5 ? ' …' : '')
        + ' ยังไม่มีคำตอบ กรุณารีเฟรชหน้าเว็บ (Ctrl+Shift+R) แล้วตอบข้อเหล่านั้น คำตอบอื่นของท่านยังอยู่ในเครื่อง' });
    }
    if (missing.length) {
      return json_({ ok: false, error: 'ข้อมูลไม่ครบ ทุกข้อต้องตอบ (ขาด ' + missing.slice(0, 5).join(', ')
        + (missing.length > 5 ? ' …' : '') + ')' });
    }
    if (badVal.length) return json_({ ok: false, error: 'ค่าคำตอบผิดรูปแบบที่ข้อ ' + badVal.slice(0, 5).join(', ') });
    if (badScore.length) return json_({ ok: false, error: 'คะแนนไม่สอดคล้องกับคำตอบที่ข้อ ' + badScore.slice(0, 5).join(', ') });

    // ---------- กันการเขียนทับข้ามคน ----------
    // รหัสเดิมจะถูกเขียนทับได้เฉพาะเมื่อมาจากรอบการตอบเดียวกัน
    var shRaw = ss.getSheetByName(SHEET_RAW);
    var prev = findRow_(shRaw, p.id);
    var rawHeader = shRaw.getRange(1, 1, 1, Math.max(1, shRaw.getLastColumn())).getValues()[0];
    var iSession = rawHeader.indexOf('session');
    if (prev.row > 0 && iSession >= 0 && String(prev.values[iSession] || '') !== String(p.session || '')) {
      ss.getSheetByName(SHEET_CONFLICT).appendRow(
        [p.id, p.session, p.submittedAt, 'รหัสซ้ำกับผู้ตอบรายอื่น ระบบไม่เขียนทับข้อมูลเดิม']
        .concat(codes.map(function (c) { var v = p.scored ? p.scored[c] : null; return (v == null) ? '' : v; })));
      return json_({ ok: false, error: 'รหัสผู้ตอบซ้ำกับรายอื่น กรุณาบันทึกเป็นไฟล์แล้วแจ้งผู้วิจัย' });
    }

    // ---------- คะแนน (ช่องว่าง = ข้อมูลขาดหาย) ----------
    var shScored = ss.getSheetByName(SHEET_SCORED);
    var ids = shScored.getLastRow() > 1
      ? shScored.getRange(2, 1, shScored.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
      : [];
    var at = ids.indexOf(p.id);
    var rowIdx = at >= 0 ? at + 2 : shScored.getLastRow() + 1;   // ส่งซ้ำจากการลองส่งใหม่ จะเขียนทับแถวเดิม
    var scored = [p.id].concat(codes.map(function (c) {
      var v = p.scored ? p.scored[c] : null;
      return (v === null || v === undefined) ? '' : v;
    }));
    shScored.getRange(rowIdx, 1, 1, scored.length).setValues([scored]);

    // ---------- ตัวเลือกดิบ และข้อมูลผู้ตอบ เขียนตามชื่อหัวคอลัมน์ ----------
    var rawObj = { ID: p.id, session: p.session, submittedAt: p.submittedAt, durationSec: p.durationSec,
                   appVersion: p.appVersion, Instrument: p.instrument };
    codes.forEach(function (c) { rawObj[c] = (raw[c] === undefined || raw[c] === null) ? '' : raw[c]; });
    putByHeader_(shRaw, p.id, rawObj);

    var d = p.demo || {};
    putByHeader_(ss.getSheetByName(SHEET_PERSON), p.id, {
      ID: p.id, startedAt: p.startedAt, submittedAt: p.submittedAt, consent: p.consent,
      sex: d.sex, vt: d.vt, yrs: d.yrs, sz: d.sz, grade: d.grade, ex: d.ex,
      durationSec: p.durationSec, Instrument: p.instrument
    });

    return json_({ ok: true, id: p.id, row: rowIdx });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function findRow_(sh, id) {
  if (sh.getLastRow() < 2) return { row: 0, values: [] };
  var n = sh.getLastColumn();
  var all = sh.getRange(2, 1, sh.getLastRow() - 1, n).getValues();
  for (var i = 0; i < all.length; i++) if (all[i][0] === id) return { row: i + 2, values: all[i] };
  return { row: 0, values: [] };
}

/**
 * เขียนหนึ่งแถวตามชื่อหัวคอลัมน์ ไม่ขึ้นกับลำดับคอลัมน์
 * หัวคอลัมน์ที่ยังไม่มีในชีตจะถูกเพิ่มต่อท้ายอัตโนมัติ จึงใช้กับชีตเดิมที่สร้างจากรุ่นก่อนได้โดยคอลัมน์ไม่เลื่อน
 * คอลัมน์ที่ไม่มีค่าในรอบนี้ (เช่น คอลัมน์ของรุ่นเก่า) จะเว้นว่าง
 */
function putByHeader_(sh, id, obj) {
  var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  Object.keys(obj).forEach(function (k) {
    if (header.indexOf(k) < 0) {
      header.push(k);
      sh.getRange(1, header.length).setValue(k)
        .setFontWeight('bold').setBackground('#25486D').setFontColor('#FFFFFF');
    }
  });
  var row = header.map(function (h) {
    var v = obj[h];
    return (v === undefined || v === null) ? '' : v;
  });
  var ids = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  var at = ids.indexOf(id);
  var r = at >= 0 ? at + 2 : sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setValues([row]);
}

function doGet() {
  return json_({ ok: true, service: 'TRCA', instrument: ACCEPTED_INSTRUMENT,
                 note: 'ปลายทางนี้รับข้อมูลด้วยวิธี POST เท่านั้น' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function isPublished_(ss) {
  var sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh || sh.getLastRow() < 2) return false;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'ResultsPublished') return String(rows[i][1]).toUpperCase() === 'TRUE';
  }
  return false;
}

function handleCheckResult_(ss, id) {
  var published = isPublished_(ss);
  if (!published) return json_({ ok: true, published: false });

  var sh = ss.getSheetByName(SHEET_RESULTS);
  var found = findRow_(sh, id);
  if (found.row === 0) return json_({ ok: true, published: true, found: false });

  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var data = {};
  head.forEach(function (h, i) { data[h] = found.values[i]; });
  return json_({ ok: true, published: true, found: true, data: data });
}

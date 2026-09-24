/**
 * Code.gs — ปลายทางรับข้อมูลของระบบ TRCA
 * ใช้กับ Google Apps Script ผูกกับ Google Sheet หนึ่งไฟล์
 *
 * วิธีติดตั้ง
 *  1. สร้าง Google Sheet ใหม่ ตั้งชื่อว่า TRCA_Responses
 *  2. เมนู ส่วนขยาย > Apps Script  แล้ววางไฟล์นี้ทับโค้ดเดิมทั้งหมด
 *  3. กด Deploy > New deployment > เลือกชนิด Web app
 *       Execute as: Me
 *       Who has access: Anyone
 *  4. คัดลอก Web app URL ไปวางใน window.TRCA_CONFIG.endpoint ของ index.html
 *  5. รัน setupSheets() หนึ่งครั้งเพื่อสร้างหัวตาราง
 *
 * หมายเหตุด้านความปลอดภัย
 *  - ตั้ง Who has access เป็น Anyone เพราะครูผู้ตอบไม่ได้ล็อกอินบัญชี Google
 *  - ระบบไม่เก็บชื่อ นามสกุล หรือชื่อโรงเรียน จึงไม่มีข้อมูลระบุตัวบุคคลในชีต
 *  - หากต้องการกันการส่งซ้ำหรือการส่งจากภายนอก ให้ตั้งค่า SHARED_TOKEN แล้วส่งค่าเดียวกันจากหน้าเว็บ
 */

var SHARED_TOKEN = '';                 // เว้นว่าง = ไม่ตรวจ  ถ้าตั้งค่าต้องส่ง token มาด้วย
var SHEET_RAW    = 'Raw';              // หมายเลขตัวเลือกดิบ
var SHEET_SCORED = 'TRCA_Data';        // คะแนน โครงสร้างเดียวกับไฟล์ข้อมูลจำลอง
var SHEET_PERSON = 'Person_Info';      // ข้อมูลทั่วไปและสรุปข้อมูลขาดหาย
var SHEET_CONFLICT = 'Conflicts';      // กรณีรหัสซ้ำข้ามคน เก็บไว้ตรวจสอบ ไม่เขียนทับของเดิม

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
  ensure_(ss, SHEET_RAW,    ['ID', 'session', 'submittedAt', 'durationSec', 'appVersion'].concat(codes));
  ensure_(ss, SHEET_CONFLICT, ['ID', 'session', 'submittedAt', 'note'].concat(codes));
  ensure_(ss, SHEET_PERSON, ['ID', 'submittedAt', 'consent', 'sex', 'vt', 'yrs', 'sz', 'grade', 'ex',
                             'S_Status', 'S_NA_Count', 'A_NA_Count', 'A_NA_Pct', 'A_Over10', 'durationSec']);
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
    var codes = itemCodes_();
    setupSheets();

    // กันการเขียนทับข้ามคน: รหัสเดิมจะถูกเขียนทับได้เฉพาะเมื่อมาจากรอบการตอบเดียวกัน
    var shRaw = ss.getSheetByName(SHEET_RAW);
    var prev = findRow_(shRaw, p.id);
    if (prev.row > 0 && String(prev.values[1] || '') !== String(p.session || '')) {
      var codesC = itemCodes_();
      ss.getSheetByName(SHEET_CONFLICT).appendRow(
        [p.id, p.session, p.submittedAt, 'รหัสซ้ำกับผู้ตอบรายอื่น ระบบไม่เขียนทับข้อมูลเดิม']
        .concat(codesC.map(function (c) { var v = p.scored ? p.scored[c] : null; return (v == null) ? '' : v; })));
      return json_({ ok: false, error: 'รหัสผู้ตอบซ้ำกับรายอื่น กรุณาบันทึกเป็นไฟล์แล้วแจ้งผู้วิจัย' });
    }

    var shScored = ss.getSheetByName(SHEET_SCORED);
    // ถ้าเคยส่งรหัสนี้แล้ว ให้เขียนทับแถวเดิม เพื่อรองรับกรณีส่งซ้ำจากการลองส่งใหม่
    var ids = shScored.getLastRow() > 1
      ? shScored.getRange(2, 1, shScored.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
      : [];
    var at = ids.indexOf(p.id);
    var rowIdx = at >= 0 ? at + 2 : shScored.getLastRow() + 1;

    var scored = [p.id].concat(codes.map(function (c) {
      var v = p.scored ? p.scored[c] : null;
      return (v === null || v === undefined) ? '' : v;      // ช่องว่าง = ข้อมูลขาดหาย
    }));
    shScored.getRange(rowIdx, 1, 1, scored.length).setValues([scored]);

    var raw = [p.id, p.session, p.submittedAt, p.durationSec, p.appVersion].concat(codes.map(function (c) {
      var v = p.raw ? p.raw[c] : null;
      return (v === null || v === undefined) ? '' : v;
    }));
    writeRow_(shRaw, p.id, raw);

    var d = p.demo || {}, m = p.summary || {};
    var person = [p.id, p.submittedAt, p.consent, d.sex, d.vt, d.yrs, d.sz, d.grade, d.ex,
                  m.S_status, m.S_NA_count, m.A_NA_count, m.A_NA_pct, m.A_over10 ? 'เกิน 10%' : 'ไม่เกิน',
                  p.durationSec];
    writeRow_(ss.getSheetByName(SHEET_PERSON), p.id, person);

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

function writeRow_(sh, id, values) {
  var ids = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; })
    : [];
  var at = ids.indexOf(id);
  var r = at >= 0 ? at + 2 : sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, values.length).setValues([values]);
}

function doGet() {
  return json_({ ok: true, service: 'TRCA', note: 'ปลายทางนี้รับข้อมูลด้วยวิธี POST เท่านั้น' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// scoring.js — การให้คะแนนและการแปลงข้อมูลสำหรับ TRCA
// หลักการ: ระบบเก็บ "หมายเลขตัวเลือกดิบ" เป็นค่าหลักเสมอ แล้วจึงแปลงเป็นคะแนนภายหลัง
// ถ้าเฉลยหรือพื้นที่ผลลัพธ์เปลี่ยน จะให้คะแนนใหม่จากข้อมูลเดิมได้โดยไม่ต้องเก็บข้อมูลซ้ำ

import { ITEMS } from './items.js';

export const MISSING = '.';        // รหัสข้อมูลขาดหายในแฟ้ม .dat ของ ConQuest
export const BY_CODE = Object.fromEntries(ITEMS.map(i => [i.code, i]));
export const CODES = {
  K: ITEMS.filter(i => i.dim === 'K').map(i => i.code),
  S: ITEMS.filter(i => i.dim === 'S').map(i => i.code),
  A: ITEMS.filter(i => i.dim === 'A').map(i => i.code)
};

/**
 * แปลงหมายเลขตัวเลือกดิบเป็นคะแนน
 * @param {string} code  รหัสข้อ เช่น K01
 * @param {number|null} raw  หมายเลขตัวเลือกที่เลือก (1–4 หรือ 1–5 สำหรับมิติ A)
 * @returns {number|null}  คะแนน หรือ null เมื่อเป็นข้อมูลขาดหาย
 */
export function scoreItem(code, raw) {
  const it = BY_CODE[code];
  if (!it || raw == null) return null;
  if (it.naOption && raw === it.naOption) return null;   // A ตัวเลือกที่ 5 = ขาดหาย
  const s = it.scores[raw - 1];
  return s == null ? null : s;
}

/** แปลงคำตอบทั้งชุดเป็นแถวคะแนน 68 ช่อง ตามลำดับ K01–K28, S01–S20, A01–A20 */
export function scoreRecord(rec) {
  const row = {};
  for (const dim of ['K', 'S', 'A']) {
    for (const code of CODES[dim]) {
      if (dim === 'S' && rec.neverResearched) { row[code] = null; continue; }
      row[code] = scoreItem(code, rec.answers?.[code] ?? null);
    }
  }
  return row;
}

/** สรุปข้อมูลขาดหายรายบุคคล ใช้ตรวจเงื่อนไขร้อยละ 10 ของ ACER ConQuest 2.0 */
export function missingSummary(rec) {
  const row = scoreRecord(rec);
  const naA = CODES.A.filter(c => row[c] === null).length;
  const naS = CODES.S.filter(c => row[c] === null).length;
  return {
    A_NA_count: naA,
    A_NA_pct: naA / CODES.A.length,
    A_over10: naA / CODES.A.length > 0.10,
    S_NA_count: naS,
    S_status: rec.neverResearched ? 'ยังไม่เคยทำวิจัย' : 'เคยทำวิจัย'
  };
}

/** ตรวจว่าตอบครบทุกข้อที่ต้องตอบแล้วหรือยัง คืนรายการรหัสข้อที่ยังไม่ตอบ */
export function unanswered(rec, dim) {
  if (dim === 'S' && rec.neverResearched) return [];
  return CODES[dim].filter(c => rec.answers?.[c] == null);
}

/** แถวสำหรับส่งขึ้นฐานข้อมูล เก็บทั้งค่าดิบและคะแนน */
export function toSubmissionRow(rec) {
  const scored = scoreRecord(rec);
  const m = missingSummary(rec);
  return {
    id: rec.id,
    session: rec.session || '',
    submittedAt: new Date().toISOString(),
    consent: rec.consent ? 1 : 0,
    neverResearched: rec.neverResearched ? 1 : 0,
    demo: rec.demo,
    raw: rec.answers,
    scored,
    summary: m,
    durationSec: rec.startedAt ? Math.round((Date.now() - rec.startedAt) / 1000) : null,
    appVersion: rec.appVersion || '1.0.0'
  };
}

/** สร้างหนึ่งบรรทัดของแฟ้ม .dat ความกว้างคงที่ 79 อักขระ สำหรับ ACER ConQuest 2.0 */
export function toConQuestLine(rec) {
  const scored = scoreRecord(rec);
  const d = rec.demo || {};
  const pad = (s, n) => String(s ?? '').padEnd(n, ' ').slice(0, n);
  const cell = v => (v == null ? MISSING : String(v));
  let line = pad(rec.id, 6) + ' ';
  line += (d.vt ?? MISSING);      // คอลัมน์ 8  วิทยฐานะ 1–4
  line += (d.sz ?? MISSING);      // คอลัมน์ 9  ขนาดโรงเรียน 1–4
  line += (d.ex ?? MISSING);      // คอลัมน์ 10 ประสบการณ์วิจัย 1–3
  line += ' ';
  for (const dim of ['K', 'S', 'A']) for (const c of CODES[dim]) line += cell(scored[c]);
  return line;                    // รวม 79 อักขระ
}

/** ตารางคะแนนแบบ CSV ที่มีโครงสร้างเดียวกับชีต TRCA_Data */
export function toScoredCsv(records) {
  const head = ['ID', ...CODES.K, ...CODES.S, ...CODES.A];
  const lines = [head.join(',')];
  for (const r of records) {
    const s = scoreRecord(r);
    lines.push([r.id, ...head.slice(1).map(c => (s[c] == null ? '' : s[c]))].join(','));
  }
  return lines.join('\n');
}

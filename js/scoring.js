// scoring.js — การให้คะแนนและการแปลงข้อมูลสำหรับ TRCA (รุ่น TRCA-PROSE-20261007-R1)
// หลักการ: ระบบเก็บ "หมายเลขตัวเลือกดิบ" เป็นค่าหลักเสมอ แล้วจึงแปลงเป็นคะแนนภายหลัง
// ถ้าเฉลยหรือพื้นที่ผลลัพธ์เปลี่ยน จะให้คะแนนใหม่จากข้อมูลเดิมได้โดยไม่ต้องเก็บข้อมูลซ้ำ
//
// กติกาคำตอบ: ทุกข้อต้องตอบ 1–4 ก่อนส่ง ไม่มีตัวเลือกไม่ประสงค์ตอบในหน้าทำแบบประเมิน
// ตัวเลือกที่ได้ 0 คะแนนเป็นคะแนนจริง ช่องว่างในแฟ้มข้อมูลมาจากแหล่งอื่น (เช่น กรอกจากแบบกระดาษ) ไม่ใช่จากระบบเว็บนี้

import { ITEMS, INSTRUMENT_VERSION } from './items.js?v=3.1.0';

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
 * @param {number|null} raw  หมายเลขตัวเลือกที่เลือก (1–4)
 * @returns {number|null}  คะแนน หรือ null เมื่อไม่มีคำตอบที่ใช้ได้
 */
export function scoreItem(code, raw) {
  const it = BY_CODE[code];
  if (!it || raw == null) return null;
  const s = it.scores[raw - 1];
  return s == null ? null : s;
}

/** แปลงคำตอบทั้งชุดเป็นแถวคะแนน 68 ช่อง ตามลำดับ K01–K28, S01–S20, A01–A20 */
export function scoreRecord(rec) {
  const row = {};
  for (const dim of ['K', 'S', 'A']) {
    for (const code of CODES[dim]) {
      row[code] = scoreItem(code, rec.answers?.[code] ?? null);
    }
  }
  return row;
}

/** ตรวจว่าตอบครบแล้วหรือยัง คืนรายการรหัสข้อที่ยังไม่ตอบ */
export function unanswered(rec, dim) {
  return CODES[dim].filter(c => rec.answers?.[c] == null);
}

/** แถวสำหรับส่งขึ้นฐานข้อมูล เก็บทั้งค่าดิบและคะแนน พร้อมรุ่นเครื่องมือ */
export function toSubmissionRow(rec) {
  return {
    id: rec.id,
    session: rec.session || '',
    startedAt: rec.startedAt ? new Date(rec.startedAt).toISOString() : '',
    submittedAt: new Date().toISOString(),
    consent: rec.consent ? 1 : 0,
    demo: rec.demo,
    raw: rec.answers,
    scored: scoreRecord(rec),
    durationSec: rec.startedAt ? Math.round((Date.now() - rec.startedAt) / 1000) : null,
    appVersion: rec.appVersion || '3.1.0',
    instrument: rec.instrument || INSTRUMENT_VERSION
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

/**
 * ข้อมูลสำหรับหน้าเฉลย: เทียบคำตอบของผู้ตอบกับเฉลยรายข้อ
 * K: ถูก/ไม่ตรงเฉลย  S และ A: คะแนน 0–3 ของตัวเลือกที่เลือก (ไม่มีถูกผิด)
 * raw เป็น null ได้เฉพาะกรณีข้อมูลเก่าที่ไม่มีคำตอบข้อนั้น
 */
export function reviewRecord(rec) {
  return ITEMS.map(it => {
    const raw = rec.answers?.[it.code] ?? null;
    const score = raw == null ? null : (it.scores[raw - 1] ?? null);
    return { code: it.code, dim: it.dim, raw, score,
             correct: it.dim === 'K' && score != null ? score === 1 : null };
  });
}

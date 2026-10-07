import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const strip = source => source.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const bundle = [read('js/items.js'), read('js/scoring.js'), read('js/app.js')].map(strip).join('\n');
const VERSION = 'TRCA-PROSE-20261007-R1';
const CODES = ['K', 'S', 'A'].flatMap(d => Array.from({ length: d === 'K' ? 28 : 20 }, (_, i) => d + String(i + 1).padStart(2, '0')));
const record = (answers = {}) => ({ id: 'QA0001', session: 'qa-session', consent: true,
  demo: { sex: '1', vt: '2', yrs: '1', sz: '2', grade: '1', ex: '1' }, answers,
  startedAt: 1791345000000, instrument: VERSION, appVersion: '3.1.0', submitted: false });

function mount(saved, options = {}) {
  const dom = new JSDOM(read('index.html'), { url: 'https://trca.test/?id=QA0001', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const calls = []; const scrolls = [];
  w.scrollTo = (...args) => scrolls.push(args);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.TRCA_CONFIG = { endpoint: 'https://example.invalid/test-only', ...options.config };
  w.fetch = async (url, init) => { calls.push({ url, ...init }); if (options.fail) throw new Error('Mock network failure'); return { ok: true, json: async () => ({ ok: true }) }; };
  w.URL.createObjectURL = () => 'blob:test-only'; w.URL.revokeObjectURL = () => {};
  if (saved) w.localStorage.setItem('trca.session.v3', JSON.stringify(saved));
  if (options.storageFailure) w.Storage.prototype.setItem = () => { throw new Error('Mock quota failure'); };
  w.eval(bundle);
  const q = selector => w.document.querySelector(selector);
  const click = selector => { const e = q(selector); assert.ok(e, selector); assert.equal(e.disabled, false, selector + ' disabled'); e.click(); };
  const text = () => q('#main').textContent;
  const state = () => JSON.parse(w.localStorage.getItem('trca.session.v3'));
  return { dom, w, q, click, text, state, calls, scrolls };
}
function clickText(ctx, text, root = ctx.w.document) {
  const button = Array.from(root.querySelectorAll('button')).find(b => b.textContent.trim() === text);
  assert.ok(button, 'Button: ' + text); assert.equal(button.disabled, false); button.click();
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('question bank and scoring are byte-identical to the reviewed instrument', () => {
  const hashes = JSON.parse(read('tests/content-hashes.json'));
  for (const file of ['js/items.js', 'js/scoring.js', 'server/Code.gs']) {
    assert.equal(createHash('sha256').update(readFileSync(new URL('../' + file, import.meta.url))).digest('hex'), hashes[file]);
  }
});

test('consent gate and demographic form keep focus and do not reset scroll', () => {
  const c = mount(); assert.equal(c.q('#next').disabled, true);
  c.q('#consent').click(); c.click('#next');
  const fields = Array.from(c.w.document.querySelectorAll('select'));
  assert.equal(fields.length, 6);
  const before = c.scrolls.length;
  fields.forEach(field => { field.focus(); field.value = '1'; field.dispatchEvent(new c.w.Event('change', { bubbles: true })); assert.equal(c.w.document.activeElement, field); });
  assert.equal(c.scrolls.length, before); assert.equal(c.q('#next').disabled, false);
  c.click('#next'); assert.match(c.text(), /ความรู้ในการวิจัย/);
  c.dom.window.close();
});

test('selecting an answer stays on the question, saves it, and supports changing it', () => {
  const c = mount(record()); c.click('#next');
  c.q('#answer-2').click();
  assert.equal(c.q('.question-code').textContent, 'K01');
  assert.equal(c.state().answers.K01, 2);
  assert.equal(c.q('#next').disabled, false);
  c.q('#answer-4').click(); assert.equal(c.state().answers.K01, 4);
  assert.equal(c.w.document.querySelectorAll('input[name=response]:checked').length, 1);
  c.click('#next'); assert.equal(c.q('.question-code').textContent, 'K02');
  clickText(c, 'ย้อนกลับ'); assert.equal(c.q('#answer-4').checked, true);
  c.dom.window.close();
});

test('flags, enlarged text and exact resume position survive a reload from the old session key', () => {
  const c = mount(record()); c.click('#next'); c.q('#answer-2').click(); c.click('#flag-item'); c.click('#text-size'); c.click('#next');
  const saved = c.state(); c.dom.window.close();
  const reopened = mount(saved);
  assert.equal(reopened.q('.question-code').textContent, 'K02');
  assert.equal(reopened.w.document.body.classList.contains('large-text'), true);
  assert.equal(reopened.state().flags.K01, true);
  clickText(reopened, 'ย้อนกลับ'); assert.equal(reopened.q('#flag-item').getAttribute('aria-pressed'), 'true');
  assert.equal(reopened.q('#answer-2').checked, true);
  reopened.dom.window.close();
});

test('all 68 questions are reachable with explicit next actions; zero-experience does not skip S', () => {
  const c = mount(record()); const seen = [];
  while (!c.text().includes('ทบทวนก่อนส่งคำตอบ')) {
    const code = c.q('.question-code');
    if (code) { seen.push(code.textContent); c.q('#answer-1').click(); }
    c.click('#next');
    assert.ok(seen.length <= 68);
  }
  assert.deepEqual(seen, CODES); assert.equal(c.state().demo.ex, '1');
  assert.equal(c.q('#next').disabled, false);
  assert.equal(c.calls.length, 0); // Nothing reaches the endpoint before explicit confirmation.
  c.dom.window.close();
});

test('S cannot be skipped and the question map does not bypass its sequence', () => {
  const r = record(Object.fromEntries(CODES.filter(x => x[0] === 'K').map(x => [x, 1]))); r.lastStep = 'S01';
  const c = mount(r); assert.equal(c.q('#skip-item'), null); assert.equal(c.q('#next').disabled, true);
  clickText(c, 'ดูข้อทั้งหมด');
  assert.equal(c.q('#dialog [data-code=S02]').disabled, true);
  assert.equal(c.q('#dialog [data-code=A01]').disabled, true);
  assert.equal(c.q('#dialog [data-code=K01]').disabled, false);
  c.dom.window.close();
});

test('review filters and edit-return flow work without losing flags or answers', () => {
  const r = record(Object.fromEntries(CODES.map(x => [x, 1]))); r.lastStep = 'review'; r.flags = { S02: true };
  const c = mount(r); clickText(c, 'ไว้ทบทวน');
  assert.equal(c.w.document.querySelectorAll('#main .question-cell').length, 1);
  c.click('#main [data-code=S02]'); c.q('#answer-3').click(); clickText(c, 'บันทึกและกลับ');
  assert.match(c.text(), /ทบทวนก่อนส่งคำตอบ/); assert.equal(c.state().answers.S02, 3); assert.equal(c.state().flags.S02, true);
  c.dom.window.close();
});

test('only confirmed complete responses send; payload, scores, IDs and instrument are preserved', async () => {
  const r = record(Object.fromEntries(CODES.map(x => [x, 1]))); r.lastStep = 'review'; r.answers.K01 = 2;
  const c = mount(r); c.click('#next'); assert.equal(c.calls.length, 0);
  clickText(c, 'กลับไปทบทวน'); assert.equal(c.calls.length, 0);
  c.click('#next'); clickText(c, 'ยืนยันส่งคำตอบ'); await tick();
  assert.equal(c.calls.length, 1);
  const payload = JSON.parse(c.calls[0].body);
  assert.equal(payload.id, r.id); assert.equal(payload.session, r.session);
  assert.equal(payload.instrument, VERSION); assert.equal(payload.appVersion, '3.2.0');
  assert.equal(Object.keys(payload.raw).length, 68); assert.equal(Object.keys(payload.scored).length, 68);
  assert.equal(payload.raw.K01, 2); assert.equal(payload.scored.K01, 1);
  assert.equal(payload.raw.S01, 1); assert.equal(payload.scored.S01, 0);
  assert.equal(payload.raw.A01, 1); assert.equal(payload.scored.A01, 2);
  assert.equal(payload.consent, 1); assert.deepEqual(payload.demo, r.demo);
  assert.equal(payload.flags, undefined); assert.match(c.text(), /ส่งแบบประเมินเรียบร้อยแล้ว/);
  assert.equal(c.state().submitted, true);
  clickText(c, 'ดูเฉลยและเหตุผล'); assert.equal(c.w.document.querySelectorAll('details').length, 28);
  clickText(c, 'S · ทักษะจากสถานการณ์'); assert.equal(c.w.document.querySelectorAll('details').length, 20);
  c.dom.window.close();
});

test('incomplete records cannot submit, and failed requests retain every answer', async () => {
  const partial = record({ K01: 2 }); partial.lastStep = 'review';
  const incomplete = mount(partial); assert.equal(incomplete.q('#next').disabled, true); assert.equal(incomplete.calls.length, 0); incomplete.dom.window.close();
  const r = record(Object.fromEntries(CODES.map(x => [x, 2]))); r.lastStep = 'review';
  const c = mount(r, { fail: true }); c.click('#next'); clickText(c, 'ยืนยันส่งคำตอบ'); await tick();
  assert.match(c.text(), /ยังยืนยันการรับคำตอบไม่ได้/); assert.equal(c.state().submitted, false);
  assert.deepEqual(c.state().answers, r.answers); assert.equal(c.state().session, r.session);
  clickText(c, 'กลับไปทบทวนและส่งใหม่'); assert.equal(c.q('#next').disabled, false);
  c.dom.window.close();
});

test('storage failures are visible instead of claiming that answers are saved', () => {
  const c = mount(record(), { storageFailure: true }); c.click('#next'); c.q('#answer-1').click();
  assert.match(c.q('#save-status').textContent, /บันทึกในเครื่องไม่ได้/);
  clickText(c, 'พักการตอบ'); assert.match(c.q('#dialog').textContent, /ดาวน์โหลดคำตอบสำรอง/);
  c.dom.window.close();
});

test('stale instrument sessions do not mix with current responses', () => {
  const r = record({ K01: 2 }); r.instrument = 'old-instrument';
  const c = mount(r); assert.ok(c.q('#consent')); assert.equal(c.q('#consent').checked, false); assert.equal(c.q('#next').disabled, true);
  c.dom.window.close();
});

test('results share configuration, support Enter, and read uppercase ID from the server', async () => {
  const html = read('results.html'); assert.match(html, /js\/config\.js\?v=3.2.0/);
  const dom = new JSDOM(html, { url: 'https://trca.test/results.html', runScripts: 'outside-only' }); const w = dom.window;
  const calls = []; w.TRCA_CONFIG = { endpoint: 'https://example.invalid/test-only' };
  w.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true, published: true, found: true, data: { ID: 'QA0001', Level_K: '2', T_K: '55', Level_S: '3', T_S: '51', Level_A: '2', T_A: '52' } }) }; };
  for (const script of w.document.querySelectorAll('script:not([src])')) w.eval(script.textContent);
  const input = w.document.querySelector('#reference-id'); input.value = 'QA0001'; input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick();
  assert.equal(calls.length, 1); assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'checkResult', id: 'QA0001' });
  assert.match(w.document.querySelector('#main').textContent, /QA0001/); assert.doesNotMatch(w.document.querySelector('#main').textContent, /undefined/);
  dom.window.close();
});

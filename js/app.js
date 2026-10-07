// TRCA interface 3.2.0. Instrument text, option order, scores and payload stay unchanged.
import { ITEMS, SECTIONS, DEMOGRAPHICS, INSTRUMENT_VERSION } from './items.js?v=3.1.0';
import { CODES, unanswered, toSubmissionRow, reviewRecord } from './scoring.js?v=3.1.0';

const CFG = window.TRCA_CONFIG || {};
const VERSION = '3.2.0';
const REVEAL = CFG.revealAnswers !== false;
const LSKEY = CFG.storageKey || 'trca.session.v3';
const DIMENSIONS = ['K', 'S', 'A'];
const NAMES = { K: 'ความรู้ในการวิจัย', S: 'ทักษะการวิจัยจากสถานการณ์', A: 'คุณลักษณะการวิจัย' };
const SHORT_NAMES = { K: 'ความรู้', S: 'ทักษะจากสถานการณ์', A: 'คุณลักษณะ' };
const ENGLISH = { K: 'Knowledge', S: 'Situational research skills', A: 'Attributes' };
const $ = selector => document.querySelector(selector);
const node = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const paths = {
  next: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 4-8 9-8 9s-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  flag: '<path d="M6 21V4m0 0c4-3 8 3 13 0v9c-5 3-9-3-13 0"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
};
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>`;
function button(label, cls, action, iconName) {
  const b = node('button', 'button ' + (cls || ''));
  b.type = 'button';
  if (iconName) b.innerHTML = icon(iconName);
  b.append(node('span', '', label));
  b.addEventListener('click', action);
  return b;
}

let storageOK = true;
let savedAt = null;
let S = load() || freshRecord();
S.appVersion = VERSION;
S.flags ||= {};
let busy = false;
let showAnswers = false;
let answerTab = 'K';
let reviewFilter = 'all';
let returnToReview = false;
const flow = [{ type: 'consent' }, { type: 'demo' }];
for (const dim of DIMENSIONS) {
  flow.push({ type: 'intro', dim });
  CODES[dim].forEach(code => flow.push({ type: 'item', code, dim }));
}
flow.push({ type: 'review' }, { type: 'done' });
let pos = 0;

function newId() {
  const supplied = new URLSearchParams(location.search).get('id');
  if (supplied && /^[A-Za-z0-9]{1,6}$/.test(supplied)) return supplied.toUpperCase().padEnd(6, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(5);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return 'T' + Array.from(bytes, n => chars[n % chars.length]).join('');
}
function freshRecord() {
  return { id: newId(), session: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    consent: false, demo: {}, answers: {}, flags: {}, startedAt: Date.now(),
    appVersion: VERSION, instrument: INSTRUMENT_VERSION, submitted: false };
}
function load() {
  try {
    const r = JSON.parse(localStorage.getItem(LSKEY) || 'null');
    if (!r || r.instrument !== INSTRUMENT_VERSION || !/^[A-Z0-9]{6}$/.test(r.id || '') || !r.session) return null;
    r.answers = Object.fromEntries(ITEMS.filter(i => [1, 2, 3, 4].includes(r.answers?.[i.code])).map(i => [i.code, r.answers[i.code]]));
    r.flags = Object.fromEntries(ITEMS.filter(i => r.flags?.[i.code] === true).map(i => [i.code, true]));
    r.demo = Object.fromEntries(DEMOGRAPHICS.filter(d => Number.isInteger(Number(r.demo?.[d.id])) && Number(r.demo[d.id]) >= 1 && Number(r.demo[d.id]) <= d.opts.length).map(d => [d.id, String(r.demo[d.id])]));
    savedAt = r.savedAt || null;
    return r;
  } catch { storageOK = false; return null; }
}
function save() {
  try {
    S.savedAt = new Date().toISOString();
    localStorage.setItem(LSKEY, JSON.stringify(S));
    storageOK = true;
    savedAt = S.savedAt;
  } catch { storageOK = false; }
  updateSaveStatus();
}
function updateSaveStatus() {
  const e = $('#save-status');
  if (!e) return;
  e.classList.toggle('error', !storageOK);
  e.textContent = busy ? 'กำลังส่งคำตอบ กรุณารอสักครู่…'
    : !storageOK ? 'บันทึกในเครื่องไม่ได้ · กดพักการตอบเพื่อดาวน์โหลดสำรอง'
    : S.submitted ? 'ระบบยืนยันการรับคำตอบแล้ว'
    : savedAt ? 'บันทึกคำตอบไว้ในเครื่องแล้ว · กลับมาตอบต่อได้'
    : 'บันทึกอัตโนมัติในอุปกรณ์และเบราว์เซอร์นี้';
}
const demoComplete = () => DEMOGRAPHICS.every(d => Number(S.demo[d.id]) >= 1 && Number(S.demo[d.id]) <= d.opts.length);
const answered = dim => (dim ? CODES[dim] : ITEMS.map(i => i.code)).filter(code => [1, 2, 3, 4].includes(S.answers[code])).length;
const flagged = () => ITEMS.filter(i => S.flags[i.code]).length;
const stepKey = step => step.code || (step.type + (step.dim ? ':' + step.dim : ''));
const indexOf = type => flow.findIndex(step => step.type === type);
function resumePosition() {
  if (S.submitted) return indexOf('done');
  if (!S.consent) return 0;
  if (!demoComplete()) return indexOf('demo');
  const remembered = flow.findIndex(step => stepKey(step) === S.lastStep);
  if (remembered > 1 && remembered !== indexOf('done')) return remembered;
  const first = flow.findIndex(step => step.type === 'item' && !S.answers[step.code]);
  if (first < 0) return indexOf('review');
  return flow[first - 1]?.type === 'intro' ? first - 1 : first;
}
function go(index, remember = true) {
  if (busy) return;
  pos = Math.max(0, Math.min(flow.length - 1, index));
  if (remember) S.lastStep = stepKey(flow[pos]);
  save(); render();
}
function jumpTo(code, fromReview = false) {
  if (!canJump(code)) return;
  returnToReview = fromReview;
  closeDialog();
  go(flow.findIndex(step => step.code === code));
}
function canJump(code) {
  if (!S.consent || !demoComplete() || S.submitted) return false;
  if (S.answers[code]) return true;
  // Keep the existing S rule: answer in order, then continue to A.
  if (code[0] === 'S') {
    const first = CODES.S.findIndex(c => !S.answers[c]);
    return first < 0 || CODES.S.indexOf(code) <= first;
  }
  return code[0] !== 'A' || answered('S') === CODES.S.length;
}
function render() {
  const step = flow[pos];
  const main = $('#main'); main.replaceChildren();
  $('#actions').replaceChildren();
  const assessment = step.type !== 'consent';
  $('#workspace').classList.toggle('in-assessment', assessment);
  $('#sidebar').hidden = !assessment;
  main.className = step.dim ? 'dim-' + step.dim.toLowerCase() : '';
  if (showAnswers && S.submitted && REVEAL) renderAnswers(main);
  else ({ consent: renderConsent, demo: renderDemographics, intro: renderIntro, item: renderItem, review: renderReview, done: renderDone })[step.type](main, step);
  renderSidebar(); updateSaveStatus();
  const title = main.querySelector('h1');
  if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function setNavigation({ back = 'ย้อนกลับ', backAction, next, nextAction, nextEnabled = true, skip = false }) {
  const box = $('#actions'); box.replaceChildren();
  if (back) box.append(button(back, 'secondary', backAction || (() => go(pos - 1)), 'back'));
  if (skip) {
    const b = button('ข้ามไปก่อน', 'quiet', () => go(pos + 1)); b.id = 'skip-item'; box.append(b);
  }
  if (next) {
    const b = button(next, 'primary', nextAction || (() => go(pos + 1)));
    b.append(node('span', 'sr-only', ''));
    const arrow = node('span'); arrow.innerHTML = icon('next'); b.append(arrow);
    b.id = 'next'; b.disabled = !nextEnabled; box.append(b);
  }
}
function heading(main, eyebrow, title, description) {
  const h = node('div', 'page-heading');
  h.append(node('div', 'eyebrow', eyebrow), node('h1', '', title));
  if (description) h.append(node('p', '', description));
  main.append(h);
}
function renderSidebar() {
  const side = $('#sidebar'); side.replaceChildren();
  if (side.hidden) return;
  const total = answered();
  side.append(node('div', 'side-overline', 'YOUR ASSESSMENT'));
  const progress = node('div', 'side-progress');
  progress.innerHTML = `<div class="side-progress-title"><span>ความคืบหน้า</span><strong>${Math.round(total / ITEMS.length * 100)}<span style="font-size:13px">%</span></strong></div><div class="progress-track" role="progressbar" aria-label="จำนวนข้อที่ตอบแล้ว" aria-valuemin="0" aria-valuemax="68" aria-valuenow="${total}"><div class="progress-fill" style="width:${total / ITEMS.length * 100}%"></div></div><div class="progress-caption">ตอบแล้ว ${total} จาก ${ITEMS.length} ข้อ</div>`;
  side.append(progress);
  const steps = node('div', 'side-steps');
  DIMENSIONS.forEach((dim, idx) => {
    const step = node('button', 'side-step dim-' + dim.toLowerCase() + (flow[pos].dim === dim ? ' current' : ''));
    step.type = 'button';
    step.disabled = !S.consent || !demoComplete() || S.submitted || (dim === 'A' && answered('S') !== CODES.S.length);
    if (flow[pos].dim === dim) step.setAttribute('aria-current', 'step');
    step.setAttribute('aria-label', `ตอนที่ ${idx + 1} ${NAMES[dim]} ตอบแล้ว ${answered(dim)} จาก ${CODES[dim].length} ข้อ`);
    step.innerHTML = `<span class="dim-letter">${dim}</span><span><span class="side-name">${SHORT_NAMES[dim]}</span><small>${answered(dim)} / ${CODES[dim].length} ข้อ</small></span>${answered(dim) === CODES[dim].length ? '<span class="step-check">' + icon('check', 14) + '</span>' : ''}`;
    step.onclick = () => { returnToReview = false; go(flow.findIndex(s => s.type === 'intro' && s.dim === dim)); };
    steps.append(step);
  }); side.append(steps);
  const tools = node('div', 'side-tools');
  const map = button('ดูข้อทั้งหมด', 'secondary small full', openMap, 'grid');
  map.disabled = !demoComplete() || !S.consent || S.submitted;
  tools.append(map);
  if (!S.submitted) tools.append(button('พักการตอบ', 'quiet small full', openPause, 'pause'));
  side.append(tools);
  const note = node('div', 'side-note', 'คำตอบถูกบันทึกในเบราว์เซอร์นี้ โปรดใช้อุปกรณ์เดิมเมื่อต้องการกลับมาตอบต่อ');
  note.append(node('code', '', S.id)); side.append(note);
  const mobile = node('div', 'mobile-summary');
  mobile.append(node('span', '', `ตอบแล้ว ${total} / 68 ข้อ`));
  if (!S.submitted) {
    const mapMobile = button('เลือกข้อ', 'quiet small', openMap, 'grid'); mapMobile.disabled = map.disabled;
    mobile.append(mapMobile, button('พัก', 'quiet small', openPause, 'pause'));
  }
  side.append(mobile);
}
function renderConsent(main) {
  const hero = node('section', 'hero');
  hero.innerHTML = `<div><div class="eyebrow">สพป.เลย เขต 1 · TEACHER RESEARCH</div><h1>แบบประเมินสมรรถนะ<br><span>การวิจัยของครู</span></h1><p class="english-title">Teacher Research Competency Assessment</p><p class="lead">รู้จักสมรรถนะของตนเอง เพื่อวางแผนพัฒนา<br>และต่อยอดการวิจัยในห้องเรียน</p><div class="hero-stats"><div class="hero-stat"><strong>3</strong><span>มิติการประเมิน</span></div><div class="hero-stat"><strong>68</strong><span>ข้อคำถาม</span></div><div class="hero-stat"><strong>90<em>นาที</em></strong><span>เวลาโดยประมาณ</span></div></div></div>`;
  const overview = node('div', 'overview-card');
  overview.innerHTML = '<div class="overview-heading"><strong>ทำความรู้จักแบบประเมิน</strong><span>3 มิติ · K / S / A</span></div>';
  DIMENSIONS.forEach(dim => {
    const row = node('div', 'dimension-row dim-' + dim.toLowerCase());
    row.innerHTML = `<span class="dim-letter">${dim}</span><div><div class="dim-name">${NAMES[dim]}</div><small>${ENGLISH[dim]}</small></div><div class="dim-number">${CODES[dim].length}<small>ข้อคำถาม</small></div>`;
    overview.append(row);
  }); hero.append(overview); main.append(hero);
  if (answered()) {
    const resume = node('div', 'resume-note');
    resume.append(node('p', '', `พบคำตอบที่บันทึกไว้ ${answered()} ข้อ · รหัส ${S.id}`), button('ตอบต่อจากที่ค้าง', 'small', () => go(resumePosition())));
    main.append(resume);
  }
  main.append(node('div', 'section-rule', 'ก่อนเริ่มทำแบบประเมิน'));
  const layout = node('div', 'consent-layout');
  const instructions = node('section', 'panel');
  instructions.innerHTML = `<ol class="instruction-list"><li><strong>อ่านสถานการณ์ แล้วเลือกคำตอบ 1 ตัวเลือก</strong><br>ใช้ข้อมูลในโจทย์เป็นหลัก ไม่จำเป็นต้องเคยพบเหตุการณ์นั้นจริง</li><li><strong>ตอบด้วยตนเองตามคำชี้แจงของแต่ละมิติ</strong><br>ไม่ค้นคำตอบหรือปรึกษาผู้อื่นระหว่างตอบ</li><li><strong>ทบทวนได้ก่อนส่งคำตอบ</strong><br>ต้องตอบครบ 68 ข้อก่อนส่ง ทำเครื่องหมายข้อที่อยากกลับมาทบทวนได้</li><li><strong>หยุดพักได้ตามสะดวก</strong><br>ใช้เวลาประมาณ 90 นาที ไม่รวมคำชี้แจงและพัก กลับมาตอบต่อด้วยอุปกรณ์และเบราว์เซอร์เดิม</li>${REVEAL ? '<li><strong>เรียนรู้จากคำตอบหลังส่ง</strong><br>ดูเฉลยและเหตุผลรายข้อได้เมื่อระบบยืนยันการรับคำตอบแล้ว</li>' : ''}</ol>`;
  const privacy = node('section', 'panel');
  privacy.innerHTML = `<div class="privacy-lead">${icon('shield', 21)}<div><strong>การตอบของท่านเป็นความสมัครใจ</strong><p>แบบประเมินนี้ไม่ใช่การประเมินผลการปฏิบัติงาน และไม่มีผลต่อวิทยฐานะหรือการเลื่อนขั้นเงินเดือน</p></div></div><h3>วัตถุประสงค์และการคุ้มครองข้อมูล</h3><p class="privacy-detail">เพื่อพัฒนาเครื่องมือประเมินสมรรถนะการวิจัยของครู และนำผลไปใช้วางแผนพัฒนาครูรายบุคคลและรายกลุ่ม</p><p class="privacy-detail">ระบบไม่เก็บชื่อ นามสกุล หรือชื่อโรงเรียน ผลการตอบจะไม่ถูกส่งต่อให้ผู้บริหารสถานศึกษาหรือสำนักงานเขตพื้นที่การศึกษาเป็นรายบุคคล</p><p class="privacy-detail">ท่านหยุดตอบได้ทุกเมื่อโดยไม่ต้องแจ้งเหตุผล หากยุติก่อนกดส่ง คำตอบจะไม่ถูกส่งถึงผู้วิจัย</p><label class="consent-check"><input type="checkbox" id="consent"><span>ข้าพเจ้าอ่านคำชี้แจงแล้ว และยินดีเข้าร่วมด้วยความสมัครใจ</span></label>`;
  layout.append(instructions, privacy); main.append(layout);
  const credit = node('div', 'page-credit');
  credit.append(node('span', '', 'จัดทำโดย นายนราพงศ์ อาษารินทร์ · ศึกษานิเทศก์ สพป.เลย เขต 1'), node('span', 'reference-id', 'รหัสอ้างอิง ' + S.id));
  main.append(credit);
  $('#consent').checked = !!S.consent;
  $('#consent').onchange = e => { S.consent = e.target.checked; save(); $('#next').disabled = !S.consent; };
  setNavigation({ back: null, next: answered() ? 'ตอบต่อจากที่ค้าง' : 'เริ่มทำแบบประเมิน', nextEnabled: S.consent,
    nextAction: () => go(demoComplete() ? resumePosition() : indexOf('demo')) });
}
function renderDemographics(main) {
  heading(main, 'GETTING STARTED', 'ข้อมูลทั่วไปของผู้ตอบ', 'ใช้สำหรับวิเคราะห์ภาพรวมและตรวจสอบความเป็นธรรมของข้อคำถาม');
  const panel = node('section', 'panel'); const grid = node('div', 'form-grid');
  DEMOGRAPHICS.forEach(d => {
    const field = node('div', 'form-field');
    const label = node('label', '', d.label); label.htmlFor = 'd_' + d.id;
    const input = node('select'); input.id = label.htmlFor; input.required = true;
    input.append(new Option('เลือก' + d.label, ''));
    d.opts.forEach((option, i) => input.append(new Option(option, String(i + 1))));
    input.value = S.demo[d.id] || '';
    input.onchange = () => {
      S.demo[d.id] = input.value; save();
      $('#next').disabled = !demoComplete();
      $('#demo-status').textContent = `กรอกแล้ว ${DEMOGRAPHICS.filter(x => S.demo[x.id]).length} / ${DEMOGRAPHICS.length} รายการ`;
      renderSidebar();
    };
    field.append(label, input); grid.append(field);
  }); panel.append(grid);
  const note = node('p', 'form-note', `กรอกแล้ว ${DEMOGRAPHICS.filter(x => S.demo[x.id]).length} / ${DEMOGRAPHICS.length} รายการ`);
  note.id = 'demo-status'; note.setAttribute('aria-live', 'polite'); panel.append(note); main.append(panel);
  setNavigation({ next: 'ไปยังคำชี้แจงตอนที่ 1', nextEnabled: demoComplete() });
}
function renderIntro(main, step) {
  const sec = SECTIONS.find(s => s.dim === step.dim);
  const panel = node('section', 'panel intro-panel');
  panel.append(node('div', 'intro-symbol', step.dim), node('div', 'eyebrow', 'ตอนที่ ' + (DIMENSIONS.indexOf(step.dim) + 1)), node('h1', '', NAMES[step.dim]));
  panel.append(node('p', 'intro-count', `${sec.n} ข้อคำถาม · เลือกตอบข้อละ 1 ตัวเลือก`));
  const instructions = node('div', 'intro-instructions'); instructions.append(node('h2', '', 'คำชี้แจง'));
  sec.points.forEach(text => instructions.append(node('p', '', text))); panel.append(instructions);
  panel.append(node('p', 'subtle', step.dim === 'S' ? 'เลือกคำตอบแล้วกดถัดไป ตอบมิตินี้ตามลำดับ และย้อนกลับมาแก้ไขได้ก่อนส่ง' : 'เลือกคำตอบแล้วกดถัดไป หรือข้ามไปก่อนแล้วกลับมาทบทวนก่อนส่ง'));
  main.append(panel);
  setNavigation({ next: 'เริ่มตอนที่ ' + (DIMENSIONS.indexOf(step.dim) + 1), nextAction: () => { returnToReview = false; go(pos + 1); } });
}
function renderItem(main, step) {
  const item = ITEMS.find(i => i.code === step.code);
  const ordinal = CODES[item.dim].indexOf(item.code) + 1;
  const meta = node('div', 'question-meta');
  meta.append(node('div', 'eyebrow', `ตอนที่ ${DIMENSIONS.indexOf(item.dim) + 1} · ${SHORT_NAMES[item.dim]}`));
  const flag = button(S.flags[item.code] ? 'ทำเครื่องหมายแล้ว' : 'ไว้ทบทวน', 'quiet small flag', () => {
    if (S.flags[item.code]) delete S.flags[item.code]; else S.flags[item.code] = true;
    flag.setAttribute('aria-pressed', String(!!S.flags[item.code]));
    flag.querySelector('span').textContent = S.flags[item.code] ? 'ทำเครื่องหมายแล้ว' : 'ไว้ทบทวน'; save();
  }, 'flag'); flag.setAttribute('aria-pressed', String(!!S.flags[item.code])); flag.id = 'flag-item'; meta.append(flag); main.append(meta);
  const panel = node('section', 'panel question-card');
  const h = node('div', 'question-heading'); h.append(node('h1', '', `ข้อที่ ${String(ordinal).padStart(2, '0')}`), node('span', 'question-code', item.code)); panel.append(h);
  const stem = node('p', 'question-stem', item.stem); stem.id = 'question-stem'; panel.append(stem);
  panel.append(node('div', 'answer-instruction', 'เลือกคำตอบเพียง 1 ตัวเลือก'));
  const fieldset = node('fieldset', 'options'); fieldset.setAttribute('aria-describedby', 'question-stem');
  fieldset.append(node('legend', 'sr-only', `ตัวเลือกของข้อ ${item.code}`));
  item.options.forEach((text, i) => {
    const label = node('label', 'option');
    const input = node('input'); input.type = 'radio'; input.name = 'response'; input.value = String(i + 1); input.id = `answer-${i + 1}`; input.checked = S.answers[item.code] === i + 1;
    const number = node('span', 'option-number', String(i + 1)); number.setAttribute('aria-hidden', 'true');
    const option = node('span', 'option-text', text); const check = node('span', 'option-check'); check.innerHTML = icon('check');
    input.onchange = () => {
      S.answers[item.code] = i + 1; save(); renderSidebar();
      $('#next').disabled = false;
      const skip = $('#skip-item'); if (skip) skip.hidden = true;
      $('#selection-state').textContent = 'เลือกตัวเลือก ' + (i + 1) + ' แล้ว';
    };
    label.append(input, number, option, check); fieldset.append(label);
  }); panel.append(fieldset);
  const tip = node('div', 'question-tip'); tip.append(node('p', '', `ข้อ ${ordinal} จาก ${CODES[item.dim].length} ในมิตินี้ · เปลี่ยนคำตอบได้ก่อนส่ง`));
  const state = node('span', 'inline-state', S.answers[item.code] ? 'เลือกตัวเลือก ' + S.answers[item.code] + ' แล้ว' : 'ยังไม่ได้เลือกคำตอบ'); state.id = 'selection-state'; state.setAttribute('aria-live', 'polite'); tip.append(state); panel.append(tip); main.append(panel);
  setNavigation({
    back: returnToReview ? 'กลับหน้าทบทวน' : 'ย้อนกลับ',
    backAction: returnToReview ? () => { returnToReview = false; go(indexOf('review')); } : undefined,
    next: returnToReview ? 'บันทึกและกลับ' : item.code === 'A20' ? 'ทบทวนก่อนส่ง' : 'ถัดไป',
    nextAction: () => { const next = returnToReview ? indexOf('review') : pos + 1; returnToReview = false; go(next); },
    nextEnabled: !!S.answers[item.code], skip: item.dim !== 'S' && !S.answers[item.code] && !returnToReview
  });
}
function questionGrid(dim, filter = 'all', fromReview = false) {
  const group = node('section', 'review-dimension dim-' + dim.toLowerCase());
  const codes = CODES[dim].filter(code => filter === 'all' || (filter === 'unanswered' && !S.answers[code]) || (filter === 'flagged' && S.flags[code]));
  const h = node('div', 'review-heading'); h.append(node('h2', '', dim + ' · ' + NAMES[dim]), node('span', '', `${answered(dim)} / ${CODES[dim].length} ข้อ`)); group.append(h);
  const grid = node('div', 'question-grid');
  codes.forEach(code => {
    const b = node('button', 'question-cell' + (S.answers[code] ? ' answered' : '') + (S.flags[code] ? ' flagged' : '') + (flow[pos].code === code ? ' current' : ''), code.slice(1));
    b.type = 'button'; b.disabled = !canJump(code); b.dataset.code = code;
    b.setAttribute('aria-label', `${code} ${S.answers[code] ? 'ตอบแล้ว' : 'ยังไม่ตอบ'}${S.flags[code] ? ' ทำเครื่องหมายไว้' : ''}${b.disabled ? ' ตอบมิติ S ตามลำดับก่อนเปิดข้อนี้' : ''}`);
    b.onclick = () => jumpTo(code, fromReview); grid.append(b);
  });
  group.append(codes.length ? grid : node('p', 'empty-state', 'ไม่มีข้อในตัวกรองนี้')); return group;
}
function legend() {
  const e = node('div', 'map-legend');
  e.innerHTML = '<span class="legend-item"><i class="legend-dot done"></i>ตอบแล้ว</span><span class="legend-item"><i class="legend-dot"></i>ยังไม่ตอบ</span><span class="legend-item"><i class="legend-dot flagged"></i>ไว้ทบทวน</span>';
  return e;
}
function renderReview(main) {
  heading(main, 'REVIEW & SUBMIT', 'ทบทวนก่อนส่งคำตอบ', 'เลือกหมายเลขข้อเพื่อกลับไปอ่านหรือแก้ไขคำตอบ');
  const total = answered(); const summary = node('div', 'review-summary');
  [[total, 'ข้อที่ตอบแล้ว', 'total'], [68 - total, 'ข้อที่ยังไม่ตอบ', ''], [flagged(), 'ข้อที่ไว้ทบทวน', '']].forEach(([value, label, cls]) => {
    const e = node('div', 'review-stat ' + cls); e.append(node('strong', '', String(value)), node('span', '', label)); summary.append(e);
  }); main.append(summary);
  if (total < 68) main.append(node('div', 'notice warn', `ยังเหลือ ${68 - total} ข้อ กรุณาตอบให้ครบก่อนส่ง ส่วนมิติ S ให้ตอบตามลำดับ`));
  else if (flagged()) main.append(node('div', 'notice', `ตอบครบแล้ว มี ${flagged()} ข้อที่ทำเครื่องหมายไว้ ท่านทบทวนได้ หรือส่งคำตอบเมื่อพร้อม`));
  const panel = node('section', 'panel'); const filters = node('div', 'filter-row'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'กรองข้อคำถาม');
  [['all', 'ทุกข้อ'], ['unanswered', 'ยังไม่ตอบ'], ['flagged', 'ไว้ทบทวน']].forEach(([value, label]) => {
    const b = node('button', 'filter-button', label); b.type = 'button'; b.setAttribute('aria-pressed', String(reviewFilter === value));
    b.onclick = () => { reviewFilter = value; render(); }; filters.append(b);
  }); panel.append(filters); DIMENSIONS.forEach(dim => panel.append(questionGrid(dim, reviewFilter, true))); panel.append(legend()); main.append(panel);
  setNavigation({ next: 'ส่งแบบประเมิน', nextEnabled: total === 68, nextAction: confirmSubmission });
}
function openDialog(title, body, buttons = []) {
  const dialog = $('#dialog'); if (dialog.open) dialog.close(); dialog.replaceChildren();
  const h = node('div', 'dialog-head'); const t = node('h2', '', title); t.id = 'dialog-title';
  const close = node('button', 'dialog-close'); close.type = 'button'; close.innerHTML = icon('close'); close.setAttribute('aria-label', 'ปิด'); close.onclick = closeDialog; h.append(t, close);
  const content = node('div', 'dialog-body'); content.append(body); dialog.append(h, content);
  if (buttons.length) { const actions = node('div', 'dialog-actions'); actions.append(...buttons); dialog.append(actions); }
  dialog.showModal();
}
function closeDialog() { if ($('#dialog').open) $('#dialog').close(); }
function openMap() {
  if (!S.consent || !demoComplete() || S.submitted) return;
  const body = node('div', 'dialog-map');
  body.append(node('p', '', 'เลือกข้อที่ต้องการกลับไปตอบ มิติ S เปิดตามลำดับ และเปิดมิติ A เมื่อตอบ S ครบ'));
  DIMENSIONS.forEach(dim => body.append(questionGrid(dim, 'all', flow[pos].type === 'review'))); body.append(legend());
  openDialog('ข้อคำถามทั้งหมด', body, [button('ทบทวนก่อนส่ง', 'secondary', () => { closeDialog(); returnToReview = false; go(indexOf('review')); })]);
}
function openPause() {
  save(); const body = node('div');
  body.append(node('p', '', storageOK ? 'คำตอบล่าสุดบันทึกไว้ในอุปกรณ์นี้แล้ว ท่านปิดหน้านี้และกลับมาตอบต่อด้วยเบราว์เซอร์เดิมได้' : 'เบราว์เซอร์บันทึกคำตอบในเครื่องไม่ได้ โปรดดาวน์โหลดคำตอบสำรองก่อนปิดหน้านี้'));
  body.append(node('p', '', 'อย่าล้างข้อมูลเว็บไซต์หรือใช้โหมดไม่ระบุตัวตนหากต้องการเก็บคำตอบไว้ทำต่อ รหัสอ้างอิงของท่านคือ ' + S.id));
  openDialog('พักการตอบได้ตามสะดวก', body, [button('ดาวน์โหลดคำตอบสำรอง', 'secondary', downloadBackup, 'download'), button('ตอบต่อ', '', closeDialog)]);
}
function openHelp() {
  const list = node('ol', 'help-list');
  ['เลือกคำตอบแล้วกด “ถัดไป” ระบบจะไม่เปลี่ยนข้อเอง', 'กด “ไว้ทบทวน” เพื่อทำเครื่องหมายข้อที่อยากกลับมาดูอีกครั้ง', 'ใช้ “ดูข้อทั้งหมด” หรือ “เลือกข้อ” เพื่อย้อนกลับไปแก้ไขก่อนส่ง', 'กด “ก+” เพื่อขยายตัวอักษร และกดซ้ำเพื่อกลับขนาดปกติ', 'พักแล้วกลับมาตอบต่อได้ด้วยอุปกรณ์และเบราว์เซอร์เดิม', 'ตอบครบทุกข้อแล้วตรวจหน้าทบทวนก่อนยืนยันส่ง'].forEach(text => list.append(node('li', '', text)));
  const body = node('div'); body.append(list);
  const resultLink = node('a', 'text-link', 'ตรวจสอบผลการประเมิน'); resultLink.href = 'results.html'; body.append(resultLink);
  openDialog('วิธีใช้งานแบบประเมิน', body, [button('เข้าใจแล้ว', '', closeDialog)]);
}
function confirmSubmission() {
  if (answered() !== 68 || !S.consent || !demoComplete() || busy) return;
  const body = node('div'); body.append(node('p', '', 'ตอบครบทั้ง 68 ข้อแล้ว เมื่อยืนยัน ระบบจะส่งคำตอบไปยังผู้วิจัย'));
  if (flagged()) body.append(node('p', '', `ท่านยังทำเครื่องหมายไว้ ${flagged()} ข้อ สามารถกลับไปทบทวนก่อนส่งได้`));
  openDialog('ยืนยันส่งแบบประเมิน', body, [button('กลับไปทบทวน', 'secondary', closeDialog), button('ยืนยันส่งคำตอบ', '', () => { closeDialog(); doSubmit(); }, 'check')]);
}
async function doSubmit() {
  if (busy || S.submitted || answered() !== 68 || !S.consent || !demoComplete()) return;
  busy = true; updateSaveStatus();
  document.querySelectorAll('#actions button, #sidebar button, #main button').forEach(b => { b.disabled = true; });
  let ok = false, error = ''; const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    if (!CFG.endpoint) throw new Error('ยังไม่ได้เชื่อมต่อปลายทางรับข้อมูล กรุณาดาวน์โหลดคำตอบสำรองและติดต่อผู้วิจัย');
    const response = await fetch(CFG.endpoint, { method: 'POST', redirect: 'follow', signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(toSubmissionRow(S)) });
    if (!response.ok) throw new Error('ปลายทางตอบกลับผิดพลาด กรุณาลองส่งใหม่');
    const data = await response.json(); ok = data.ok === true;
    if (!ok) error = typeof data.error === 'string' ? data.error : 'ปลายทางยังไม่ยืนยันการรับคำตอบ';
  } catch (e) { error = e.name === 'AbortError' ? 'รอการตอบกลับนานเกินไป กรุณาตรวจการเชื่อมต่อแล้วลองส่งใหม่' : e.message || 'เชื่อมต่อไม่สำเร็จ'; }
  finally { clearTimeout(timeout); busy = false; }
  S.submitted = ok; S.submitError = ok ? '' : error; S.submittedAt = new Date().toISOString();
  pos = indexOf('done'); S.lastStep = 'done'; save(); render();
}
function renderDone(main) {
  const panel = node('section', 'panel completion-panel');
  const symbol = node('div', 'completion-symbol'); symbol.innerHTML = icon(S.submitted ? 'check' : 'clock', 32); panel.append(symbol);
  panel.append(node('h1', '', S.submitted ? 'ส่งแบบประเมินเรียบร้อยแล้ว' : 'ยังยืนยันการรับคำตอบไม่ได้'));
  panel.append(node('p', 'lead', S.submitted ? 'ขอบพระคุณที่สละเวลาให้ข้อมูล เพื่อร่วมพัฒนาการวิจัยของครู' : 'ลองส่งใหม่ได้ด้วยรหัสเดิม หรือดาวน์โหลดคำตอบสำรองไว้ก่อน'));
  if (!S.submitted) {
    panel.append(node('div', 'notice error', S.submitError || 'กรุณาตรวจสอบการเชื่อมต่อ'));
    panel.append(node('p', 'completion-note', storageOK ? 'คำตอบยังบันทึกอยู่ในเครื่อง การส่งครั้งก่อนอาจถึงปลายทางแล้วแต่ยังไม่ได้รับการยืนยัน หากลองส่งใหม่ระบบจะใช้รหัสและรอบการตอบเดิม' : 'บันทึกในเครื่องไม่ได้ โปรดดาวน์โหลดคำตอบสำรองก่อนปิดหน้านี้'));
  }
  const receipt = node('div', 'receipt'); receipt.append(node('small', '', 'รหัสอ้างอิงของท่าน'), node('strong', '', S.id));
  const copy = button('คัดลอกรหัส', 'quiet small', async () => {
    try { await navigator.clipboard.writeText(S.id); copy.querySelector('span').textContent = 'คัดลอกแล้ว'; }
    catch { copy.querySelector('span').textContent = 'โปรดจดรหัสด้านบน'; }
  }, 'copy'); receipt.append(copy); panel.append(receipt);
  const stats = node('div', 'completion-stats');
  DIMENSIONS.forEach(dim => {
    const stat = node('div', 'completion-stat dim-' + dim.toLowerCase());
    stat.append(node('strong', '', `${answered(dim)}/${CODES[dim].length}`), node('span', '', `${dim} · ${SHORT_NAMES[dim]}`)); stats.append(stat);
  }); panel.append(stats);
  if (S.submitted && REVEAL) {
    const actions = node('div', 'completion-actions'); actions.append(button('ดูเฉลยและเหตุผล', 'secondary', () => { showAnswers = true; answerTab = 'K'; render(); })); panel.append(actions);
  }
  panel.append(node('p', 'completion-note', S.submitted ? 'เก็บรหัสอ้างอิงไว้ตรวจสอบผลภายหลัง เฉลยรายข้อเป็นข้อมูลเพื่อการเรียนรู้ การแปลระดับสมรรถนะต้องอาศัยผลวิเคราะห์และเกณฑ์ที่ตรวจสอบแล้ว' : 'ท่านยังกลับไปทบทวนคำตอบก่อนลองส่งใหม่ได้'));
  main.append(panel);
  const actions = $('#actions');
  actions.append(button('สำรองคำตอบ', 'secondary', downloadBackup, 'download'));
  if (S.submitted) { const link = node('a', 'button primary', 'ตรวจสอบผลภายหลัง'); link.href = 'results.html?id=' + encodeURIComponent(S.id); actions.append(link); }
  else actions.append(button('กลับไปทบทวนและส่งใหม่', 'primary', () => go(indexOf('review'))));
}
function renderAnswers(main) {
  heading(main, 'LEARN & REFLECT', 'เฉลยและเหตุผล', 'ทบทวนคำตอบเพื่อใช้เรียนรู้และพัฒนาตนเอง');
  main.append(node('div', 'notice', 'K มีคำตอบถูกเพียงตัวเลือกเดียว ส่วน S และ A ให้คะแนน 0–3 ตามเกณฑ์ของแต่ละข้อ คะแนนรายข้อนี้ไม่ใช่ระดับสมรรถนะหรือผลประเมินการปฏิบัติงาน'));
  const tabs = node('div', 'answer-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'เลือกมิติเพื่ออ่านเฉลย');
  DIMENSIONS.forEach(dim => { const b = node('button', 'filter-button', dim + ' · ' + SHORT_NAMES[dim]); b.type = 'button'; b.setAttribute('aria-pressed', String(answerTab === dim)); b.onclick = () => { answerTab = dim; render(); }; tabs.append(b); }); main.append(tabs);
  const reviews = Object.fromEntries(reviewRecord(S).map(r => [r.code, r]));
  ITEMS.filter(item => item.dim === answerTab).forEach(item => {
    const review = reviews[item.code]; const d = node('details', 'answer-details');
    const summary = node('summary'); summary.append(node('span', '', item.code), node('span', '', review.raw == null ? 'ไม่มีคำตอบ' : `${item.dim === 'K' ? (review.correct ? 'ตอบถูก' : 'ไม่ตรงเฉลย') : 'ได้ ' + review.score + '/3 คะแนน'} · เลือก ${review.raw}`)); d.append(summary);
    const body = node('div', 'answer-body'); body.append(node('p', 'answer-stem', item.stem)); const options = node('ol', 'answer-options');
    item.options.forEach((text, idx) => {
      const selected = review.raw === idx + 1; const best = item.dim === 'K' ? item.key === idx + 1 : item.scores[idx] === 3;
      const li = node('li', (selected ? 'mine ' : '') + (best ? 'best' : '')); li.append(node('div', '', `${idx + 1}. ${text}`));
      if (selected) li.append(node('span', 'score-tag', 'ท่านเลือก'));
      if (item.dim === 'K' && best) li.append(node('span', 'score-tag', 'เฉลย'));
      if (item.dim !== 'K') { li.append(node('span', 'score-tag', item.scores[idx] + ' คะแนน'), node('span', 'reason', item.why[idx])); }
      options.append(li);
    }); body.append(options); if (item.dim === 'K') body.append(node('p', 'answer-rationale', 'เหตุผล · ' + item.reason)); d.append(body); main.append(d);
  });
  $('#actions').append(button('กลับหน้าสรุป', 'secondary', () => { showAnswers = false; render(); }, 'back'));
}
function downloadBackup() {
  const payload = toSubmissionRow(S);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = `TRCA_${S.id}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function updateNetwork() {
  const banner = $('#connection-status'); banner.hidden = navigator.onLine !== false;
  banner.textContent = 'ขณะนี้ไม่มีอินเทอร์เน็ต · ตอบในหน้าที่เปิดอยู่ต่อได้ และเชื่อมต่ออีกครั้งก่อนส่ง';
}
$('#help').onclick = openHelp;
$('#text-size').onclick = () => {
  S.largeText = !S.largeText; document.body.classList.toggle('large-text', S.largeText);
  $('#text-size').setAttribute('aria-pressed', String(S.largeText));
  $('#text-size').setAttribute('aria-label', S.largeText ? 'ใช้ขนาดตัวอักษรปกติ' : 'เพิ่มขนาดตัวอักษร'); save();
};
document.body.classList.toggle('large-text', !!S.largeText);
$('#text-size').setAttribute('aria-pressed', String(!!S.largeText));
if (S.largeText) $('#text-size').setAttribute('aria-label', 'ใช้ขนาดตัวอักษรปกติ');
window.addEventListener('online', updateNetwork); window.addEventListener('offline', updateNetwork);
window.addEventListener('beforeunload', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
pos = resumePosition();
updateNetwork(); render();

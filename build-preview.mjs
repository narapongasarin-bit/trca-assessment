// Build a single-file, offline-openable demonstration. Never uses the live endpoint.
import { readFileSync, writeFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const strip = s => s.replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const source = [read('js/items.js'), read('js/scoring.js'), read('js/app.js')].map(strip).join('\n').replace(/<\/script/gi, '<\\/script');
let html = read('index.html');
html = html.replace('<title>TRCA · แบบประเมินสมรรถนะการวิจัยของครู</title>', '<title>ตัวอย่างหน้าตา TRCA · ไม่ส่งข้อมูลจริง</title>');
html = html.replace('<link rel="stylesheet" href="css/assessment.css?v=3.2.0">', '<style>' + read('css/assessment.css') + '</style>');
html = html.replace('<script src="js/config.js?v=3.2.0"></script>', '<script>window.TRCA_CONFIG={endpoint:"",revealAnswers:true,storageKey:"trca.ui-preview.v3.2"};</script>');
html = html.replaceAll('src="assets/logo-sppo-loei1.jpg"', 'src="https://narapongasarin-bit.github.io/trca-assessment/assets/logo-sppo-loei1.jpg"');
html = html.replace('<body>', '<body><div class="preview-banner"><strong>ตัวอย่างหน้าตาและการใช้งาน</strong> · คำตอบในหน้านี้ไม่ส่งถึงผู้วิจัย · <button id="reset-preview" type="button" style="font:inherit;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer">เริ่มตัวอย่างใหม่</button></div>');
html = html.replace('<script type="module" src="js/app.js?v=3.2.0"></script>', '<script>(()=>{\n' + source + '\n})();</script><script>document.getElementById("reset-preview").onclick=()=>{localStorage.removeItem("trca.ui-preview.v3.2");location.reload()};document.addEventListener("click",e=>{const a=e.target.closest("a");if(a&&/^(index|results)\\.html/.test(a.getAttribute("href")||"")){e.preventDefault();alert("นี่คือหน้าตัวอย่าง กรุณาใช้เว็บไซต์จริงเพื่อตอบหรือดูผลการประเมิน");}});</script>');
const output = process.argv[2] || 'preview.html';
writeFileSync(output, html);
console.log('Created preview (live endpoint disabled):', output);

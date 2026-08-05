// Build a standalone "Detection Criteria" documentation page.
// Output: output/criteria.html — deployed alongside the dashboard.

import { writeFile, mkdir } from 'node:fs/promises';
import { renderNav } from './nav.js';
import { DIR, PASS_THRESHOLD, THAI_RATIO_DELTA,
  TEXT_MATCH_TOLERANCE, MAX_LINK_CHECKS, LINK_CHECK_BATCH,
  CONTENT_ORDER_PASS, LAYOUT_PROFILE_PASS, SEGMENT_MIN_CHARS, DOWNLOAD_EXTENSIONS,
  META_KEYS, META_INFO_KEYS,
  WEIGHTS_MAIN_V2, CRITERIA_GROUPS_V2 } from '../config.js';

async function main() {
  await mkdir(DIR.output, { recursive: true });
  const html = renderDoc();
  await writeFile(`${DIR.output}/criteria.html`, html, 'utf8');
  console.log(`✅ Criteria page → ${DIR.output}/criteria.html`);
}

function renderDoc() {
  // Everything below describes the v2 (defect-aligned) criteria — the same
  // WEIGHTS_MAIN_V2 / CRITERIA_GROUPS_V2 that rescore.js scores with. Reading
  // the weights straight from config is what keeps this page from drifting: it
  // previously rendered the v1 set and still advertised checks that no longer
  // exist (canonical, alt-text matching, header/footer menus).
  const LABELS = {
    contentLength:   ['Content length (เนื้อหาหลัก)', `AEM อยู่ใน ±${Math.round(TEXT_MATCH_TOLERANCE * 100)}% ของ prod`,
      'เทียบความยาวข้อความเฉพาะ<b>เนื้อหาหลัก</b> — ตัด header/footer/menu และบล็อกที่ไม่ถูก render (prod ฝัง modal ซ่อนไว้ในหน้า ซึ่งเคยทำให้ตัวเลขพองกว่าจริง 4 เท่า)'],
    missingText:     ['Missing text (ระดับประโยค)', 'ไม่มีประโยคหาย',
      `ตัดข้อความที่มองเห็นของ prod เป็นประโยค (≥${SEGMENT_MIN_CHARS} ตัวอักษร) แล้วหาว่ามีอยู่ใน AEM ไหม — เทียบแบบไม่สนช่องว่าง จึงไม่ขึ้นกับว่าใครใช้ &lt;p&gt; หรือ &lt;table&gt;`],
    missingImage:    ['Missing image', 'จำนวน ≥ 80% ของ prod',
      'นับรูปในเนื้อหาหลัก <b>รวม CSS background-image</b> ไม่ใช่แค่ &lt;img&gt; — prod เสิร์ฟรูปเนื้อหาเป็น background เป็นส่วนใหญ่ ถ้านับแต่แท็กจะมองไม่เห็น'],
    brokenImage:     ['Broken image (ฝั่ง AEM)', 'ไม่มีรูปที่โหลดไม่ขึ้น',
      'รูปบน AEM ที่แท็ก render แล้วแต่ไฟล์โหลดไม่สำเร็จ (naturalWidth 0 ทั้งที่ complete แล้ว) — ยกเว้น .svg และ data: URI รูปที่ยังโหลดค้างอยู่ไม่นับว่าพัง'],
    contentOrder:    ['Content order', `ลำดับตรง ≥ ${Math.round(CONTENT_ORDER_PASS * 100)}%`,
      'บล็อกข้อความที่มีทั้งสองฝั่งต้องเรียงลำดับเดียวกับ prod (หาด้วย LIS)'],
    visualLayout:    ['Visual layout (column profile)', `โปรไฟล์ตรง ≥ ${Math.round(LAYOUT_PROFILE_PASS * 100)}%`,
      'เทียบการกระจายเนื้อหาแนวนอนจาก screenshot — normalize แล้วจึงไม่ขึ้นกับความสูงหน้า และซ่อน cookie banner ก่อนถ่ายเพื่อไม่ให้ overlay ถูกนับเป็นความต่างของ layout'],
    missingDownloadLink: ['Download links present', 'ครบทุกไฟล์',
      `ไฟล์ ${DOWNLOAD_EXTENSIONS.join('/')} ของ prod ต้องมีบน AEM (เทียบจากชื่อไฟล์)`],
    deadDownloadLink:    ['Download links alive', 'ไม่มีลิงก์ตอบ ≥ 400',
      'HEAD check ลิงก์ดาวน์โหลดบน AEM จาก cache — ถ้ายังไม่มีข้อมูล check นี้จะถูกกันออกจากคะแนน ไม่ใช่ตัดสินว่าตก'],
    headings:        ['Headings (Jaccard)', 'Jaccard > 0.6', 'เปรียบเทียบชุด heading text ด้วย Jaccard index'],
    links:           ['Links match', 'match > 50%', 'เปอร์เซ็นต์ของ link text ใน prod ที่พบใน AEM'],
    meta:            ['Meta tags', `ตรงครบ ${META_KEYS.length} รายการ (partial credit)`,
      `คิดคะแนน: ${META_KEYS.join(', ')} — og:image เทียบว่า<b>มี path ทั้งสองฝั่ง</b>เท่านั้น เพราะสองระบบเก็บไฟล์คนละที่และ AEM ตั้งชื่อเป็น hash · แจ้งเฉยๆ ไม่คิดคะแนน: ${META_INFO_KEYS.join(', ')} · canonical ถูกตัดออกทั้งหมด`],
    template:        ['Template (component ในหน้า)', 'component แต่ละ type ≥ 80%',
      'เทียบ accordion/table/form/video เฉพาะในเนื้อหาหลัก — header/footer เป็น chrome ระดับเว็บ ย้ายไปรายงานครั้งเดียวบน dashboard'],
  };
  const scoredCount = Object.keys(WEIGHTS_MAIN_V2).length;
  const criteriaRows = CRITERIA_GROUPS_V2.map(g => {
    const head = `<tr class="group"><td colspan="4"><b>${g.label}</b> — ${Math.round(g.weight * 100)}%</td></tr>`;
    const body = g.checks.map(id => {
      const [name, pass, desc] = LABELS[id] || [id, '', ''];
      return `<tr><td><b>${name}</b></td><td>${Math.round(WEIGHTS_MAIN_V2[id] * 100)}%</td><td>${pass}</td><td>${desc}</td></tr>`;
    }).join('');
    return head + body;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Detection Criteria — BBL Migration Parity Checker</title>
<style>${CSS}</style>
</head><body>
${renderNav('criteria')}
<div class="wrap">

<header>
  <h1>📋 เกณฑ์ตรวจจับและวิธีการ</h1>
  <p class="meta">BBL Migration Parity Checker · อธิบายทุก check ที่เครื่องมือใช้ตรวจ + วิธีการ + เกณฑ์ผ่าน/ไม่ผ่าน</p>
</header>

<!-- ─── SCORING ─────────────────────────────────────────────────── -->
<section class="panel">
  <h2>1. การให้คะแนน Parity Score</h2>
  <p>แต่ละหน้าจะได้ <b>Parity Score (0–100%)</b> คำนวณจาก <b>${scoredCount} checks ใน ${CRITERIA_GROUPS_V2.length} groups</b> ผ่านเมื่อ <b>≥ ${PASS_THRESHOLD}%</b></p>
  <p class="muted">เกณฑ์ชุดนี้ออกแบบตาม defect ที่ QA เจอซ้ำจริง — เนื้อหาหาย, รูปหาย, การจัดวางเพี้ยน, ลิงก์ดาวน์โหลดพัง — น้ำหนักจึงเทไปที่ 4 กลุ่มแรก ส่วน structure เหลือ 10%</p>
  <table class="crit-table">
    <thead><tr><th>Check</th><th>น้ำหนัก</th><th>เกณฑ์ผ่าน</th><th>วิธีคำนวณ</th></tr></thead>
    <tbody>
${criteriaRows}
    </tbody>
  </table>
  <div class="note">
    <b>Partial credit:</b> แม้ check ไม่ผ่าน ก็ยังได้คะแนนบางส่วนตามสัดส่วน (เช่น headings ที่ Jaccard 40% ได้ 40% ของน้ำหนักตัวเอง)
  </div>
  <div class="note">
    <b>ข้อมูลไม่พอ = ไม่ตัดสิน:</b> check ที่ไม่มีอะไรให้เทียบ (เช่น ทั้งสองฝั่งไม่มีไฟล์ดาวน์โหลด) จะถูกกันออกจาก<b>ทั้งตัวตั้งและตัวหาร</b> ไม่ใช่นับเป็นตก — หน้านั้นจึงไม่ถูกลงโทษเพราะไม่มีของให้ตรวจ
  </div>
  <div class="note">
    <b>สิ่งที่ถอดออกจากการคิดคะแนน</b> (เพราะสองระบบเทียบกันไม่ได้จริง ไม่ใช่เพราะเว็บผิด):
    <ul>
      <li><b>Image alt text</b> — prod เขียน alt เป็นไทย AEM เป็นอังกฤษสำหรับรูปเดียวกัน และ prod ไม่ได้ใส่รูปเนื้อหาเป็น &lt;img&gt; เลย ทำให้ AEM ที่ทำ alt ดีกว่ากลับได้ 0%</li>
      <li><b>Image distortion / ratio</b> — AEM ตั้งชื่อไฟล์เป็น hash จับคู่รูปตามชื่อไม่ได้ ต้องจับตามลำดับ ซึ่งเอารูปคนละรูปมาเทียบสัดส่วนกัน</li>
      <li><b>Header / footer menu</b> — เป็น chrome ระดับเว็บ เหมือนกันทุกหน้า ย้ายไปรายงานครั้งเดียวใน panel <b>Site chrome</b> บน dashboard</li>
      <li><b>canonical</b> — คนละโดเมนโดยธรรมชาติ · <b>keywords</b> และ <b>Thai/English balance</b> เหลือแค่แจ้งเตือน ไม่คิดคะแนน</li>
    </ul>
  </div>
</section>

<!-- ─── ERROR DETECTION ─────────────────────────────────────────── -->
<section class="panel">
  <h2>2. การตรวจจับ Error Pages (ไม่นับเป็น parity)</h2>
  <p>หน้าที่เป็น error จะ <b>parity = 0%</b> ทันที ไม่เทียบต่อ — เพราะไม่มีเนื้อหาให้เปรียบเทียบ</p>
  <table class="crit-table">
    <thead><tr><th>สถานะ</th><th>Badge</th><th>วิธีตรวจจับ</th><th>ความหมาย</th></tr></thead>
    <tbody>
      <tr>
        <td><b>AEM 404</b></td>
        <td><span class="badge aem404">AEM 404</span></td>
        <td>title มี "404" หรือ "not found" หรือ body มี "ไม่พบหน้าที่คุณต้องการ"</td>
        <td><b>หน้ายังไม่ถูก migrate</b> — URL มีใน prod แต่ AEM ยังเป็น 404</td>
      </tr>
      <tr>
        <td><b>PROD 404</b></td>
        <td><span class="badge prod404">PROD 404</span></td>
        <td>title มี "404" หรือ "not found" หรือ body มี "ไม่พบหน้าที่คุณต้องการ" (ฝั่ง prod)</td>
        <td><b>ต้นฉบับหายไป</b> — URL อาจถูกลบจาก production แล้ว ไม่มีอะไรให้เทียบ</td>
      </tr>
      <tr>
        <td><b>BOTH 404</b></td>
        <td><span class="badge both404">BOTH 404</span></td>
        <td>ทั้ง prod และ AEM เป็น 404</td>
        <td><b>URL ไม่มีอยู่จริง</b> — อาจเป็น URL เก่าใน sheet ที่ถูกลบไปแล้ว</td>
      </tr>
      <tr>
        <td><b>BLOCKED</b></td>
        <td><span class="badge blocked">BLOCKED</span></td>
        <td>title มี "Access Denied" / "Forbidden" / "Blocked" หรือ body มี access-denied text</td>
        <td><b>ถูก WAF/anti-bot block</b> — prod ปฏิเสธการเข้าถึง ต้อง re-capture ภายหลัง (อาจเป็น rate limit ชั่วคราว)</td>
      </tr>
    </tbody>
  </table>
</section>

<!-- ─── ADDITIONAL CHECKS ───────────────────────────────────────── -->
<section class="panel">
  <h2>3. การตรวจจับเพิ่มเติม (Additional Issues)</h2>
  <p>นอกเหนือจาก parity score ยังตรวจหาปัญหาเฉพาะด้าน — นับเป็น "issues" ไม่กระทบ score โดยตรง แต่แสดงใน drill-down</p>

  <div class="check-card">
    <h3>🇹🇭 Thai/Latin Script Ratio</h3>
    <div class="check-row"><b>จุดประสงค์:</b> ตรวจจับหน้าที่ AEM แสดงผิดภาษา (แสดงภาษาอังกฤษแทนไทย)</div>
    <div class="check-row"><b>วิธีการ:</b> นับตัวอักษรไทย <code>[\\u0E00-\\u0E7F]</code> เทียบกับ Latin <code>[A-Za-z]</code> คำนวณ ratio = Thai / (Thai + Latin) ของทั้ง prod และ AEM</div>
    <div class="check-row"><b>เกณฑ์ flag:</b> ถ้า |prod ratio - AEM ratio| > <code>${THAI_RATIO_DELTA}</code> (10%) = ปัญหาภาษา</div>
    <div class="check-row"><b>ตัวอย่าง:</b> prod 98% Thai vs AEM 82% Thai → delta 16% → flag High severity</div>
  </div>

  <div class="check-card">
    <h3>🔗 Broken Link Detection</h3>
    <div class="check-row"><b>จุดประสงค์:</b> ตรวจจับ links ที่ migrate แล้วพัง (HTTP error)</div>
    <div class="check-row"><b>วิธีการ:</b> fetch แต่ละ link ในหน้า AEM <b>จากใน browser เดียวกัน</b> (in-browser fetch ผ่าน WAF ได้) — ใช้ HEAD ก่อน ถ้า 405/501 ใช้ GET แทน ทำเป็น batch ละ ${LINK_CHECK_BATCH} ตัว</div>
    <div class="check-row"><b>ขอบเขต:</b> เช็คสูงสุด ${MAX_LINK_CHECKS} links/หน้า (เฉพาะ same-origin AEM links เพื่อหลีก CORS)</div>
    <div class="check-row"><b>เกณฑ์ flag:</b> HTTP status ≥ 400 = High (broken), status 0 = Medium (unreachable/CORS)</div>
  </div>


  <div class="check-card">
    <h3>🔢 Dynamic Block Filter</h3>
    <div class="check-row"><b>จุดประสงค์:</b> ลด false positive จากเนื้อหาที่เปลี่ยนทุกวัน (วันที่, อัตราดอกเบี้ย, counter)</div>
    <div class="check-row"><b>วิธีการ:</b> กรอง text block ออกก่อนเทียบ content ถ้า:</div>
    <ul>
      <li>สัดส่วนตัวเลข > 40% ของตัวอักษรทั้งหมด (เช่น "ดอกเบี้ย 2.75% ต่อปี")</li>
      <li>ตรงกับ regex เดือนไทย + ปี (เช่น "ม.ค. 2568", "ธันวาคม 2567")</li>
    </ul>
    <div class="check-row"><b>ผล:</b> block เหล่านี้จะไม่ถูกนับเป็น "missing text" แม้ prod/AEM จะต่างกัน เพราะเป็นข้อมูลที่คาดว่าจะเปลี่ยน</div>
  </div>

  <div class="check-card">
    <h3>🛡️ AEM-specific Issues</h3>
    <div class="check-row"><b>Leaked /content/ paths:</b> ตรวจหา AEM internal JCR paths (เช่น <code>/content/bangkokbank/th/locate-us</code>) ที่หลุดสู่ HTML แทนที่จะเป็น clean URL — บ่งบอก Sling Mapping ยังไม่ตั้งค่า</div>
    <div class="check-row"><b>Missing features:</b> เปรียบเทียบ features ระหว่าง prod และ AEM — login button, language switcher, social icons (Facebook/Line/X), cookie banner</div>
  </div>
</section>

<!-- ─── METHOD ──────────────────────────────────────────────────── -->
<section class="panel">
  <h2>4. วิธีการเก็บข้อมูล (Capture Method)</h2>
  <table class="crit-table">
    <thead><tr><th>ขั้นตอน</th><th>รายละเอียด</th></tr></thead>
    <tbody>
      <tr><td><b>Browser</b></td><td>Puppeteer-core + Chrome for Testing (headless)</td></tr>
      <tr><td><b>Viewport</b></td><td>1440×900 (desktop)</td></tr>
      <tr><td><b>Navigation</b></td><td><code>domcontentloaded</code> + รอ <code>scrollHeight ≥ viewport</code> (AEM client-render ต้องรอ layout settle)</td></tr>
      <tr><td><b>DOM extraction</b></td><td><code>page.evaluate()</code> ดึง metrics ทั้งหมดในครั้งเดียว (headings, links, images, text, meta, accordions, social, features)</td></tr>
      <tr><td><b>textContent vs innerText</b></td><td>ใช้ <code>textContent</code> (ไม่ใช่ <code>innerText</code>) เพราะ AEM ซ่อน content ด้วย CSS ระหว่าง load ทำให้ innerText คืน 0</td></tr>
      <tr><td><b>Text cleaning</b></td><td>Clone body → ลบ script/style/iframe/noscript/template/svg → เอา textContent (ไม่มี HTML tags หรือ JS code ปน)</td></tr>
      <tr><td><b>Screenshot</b></td><td>Full-page JPEG, resize เหลือ width 800px, quality 80 (ลดขนาดไฟล์ ~8 เท่า)</td></tr>
      <tr><td><b>Concurrency</b></td><td>2–4 workers ขนาน (แต่ละ worker เปิด 2 pages: prod + AEM)</td></tr>
      <tr><td><b>Resumable</b></td><td>เก็บผลใน results.json — re-run จะ skip หน้าที่ capture แล้ว และ re-score จาก cached metrics (ไม่ต้องเปิด browser)</td></tr>
      <tr><td><b>Incremental save</b></td><td>บันทึกทุก 10 หน้า ป้องกันข้อมูลสูญหายถ้า crash</td></tr>
    </tbody>
  </table>
</section>

<!-- ─── LIMITATIONS ─────────────────────────────────────────────── -->
<section class="panel">
  <h2>5. ข้อจำกัดและข้อควรทราบ</h2>
  <ul class="lim-list">
    <li><b>Parity score เป็น heuristic</b> — ไม่ใช่ pixel-perfect diff ใช้ set-membership + threshold ไม่ใช่ diff algorithm อย่าง LCS</li>
    <li><b>Link matching ใช้ text ไม่ใช่ href</b> — เพราะ prod ใช้ <code>/th-TH/Personal/...</code> ส่วน AEM ใช้ <code>/th/personal/...</code> (different URL pattern)</li>
    <li><b>Image matching ใช้ order-based</b> — เพราะ AEM hash filenames ทำให้ filename matching ไม่ work อาจ match ผิดถ้าลำดับรูปเปลี่ยน</li>
    <li><b>AEM client-render ช้า</b> — บางหน้าต้องรอ layout settle นานถึง 18 วินาที ทำให้ capture ช้ากว่า prod</li>
    <li><b>WAF block เป็นชั่วคราว</b> — หน้าที่ BLOCKED สามารถ re-capture ใหม่ได้ (อาจผ่านในรอบถัดไป)</li>
    <li><b>Dynamic content กรองได้ไม่หมด</b> — filter ครอบคลุมตัวเลข > 40% และเดือนไทย แต่ข้อมูลแบบอื่น (เช่น ชื่อผู้บริหารที่เปลี่ยน) ยังนับเป็น missing</li>
    <li><b>Broken link check เช็คเฉพาะ same-origin</b> — cross-origin links จะได้ status 0 (CORS) ไม่สามารถเช็คได้จากใน browser</li>
  </ul>
</section>

<footer class="foot">
  BBL Migration Parity Checker · Detection Criteria Documentation<br>
  อัปเดตล่าสุด: ${new Date().toLocaleDateString('th-TH')} · <a href="priority-dashboard.html">← กลับ Dashboard</a>
</footer>

</div></body></html>`;
}

const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:-apple-system,"Segoe UI","Sukhumvit Set",Roboto,sans-serif; color:#1a1a1a; background:#f4f5f7; line-height:1.6; }
.topnav { display:flex; gap:4px; background:#1a2b5c; padding:0 40px; position:sticky; top:0; z-index:100; box-shadow:0 2px 8px rgba(0,0,0,.15); }
.topnav a { color:rgba(255,255,255,.7); text-decoration:none; padding:12px 18px; font-size:14px; font-weight:500; border-bottom:3px solid transparent; transition:all .15s; }
.topnav a:hover { color:#fff; background:rgba(255,255,255,.1); }
.topnav a.active { color:#fff; border-bottom-color:#4dabf7; font-weight:600; }
.wrap { max-width:900px; margin:0 auto; padding:32px 40px; }
header { margin-bottom:20px; }
h1 { font-size:26px; color:#1a2b5c; margin-bottom:4px; }
h2 { font-size:18px; color:#1a2b5c; margin-bottom:12px; padding-bottom:6px; border-bottom:2px solid #1a2b5c; }
h3 { font-size:15px; color:#1a2b5c; margin-bottom:8px; }
.meta { color:#666; font-size:13px; margin-bottom:8px; }
.back-link { display:inline-block; font-size:12px; color:#1a2b5c; text-decoration:none; }
.panel { background:#fff; border-radius:10px; padding:20px 24px; margin:16px 0; box-shadow:0 1px 4px rgba(0,0,0,.06); }
.panel p { margin-bottom:10px; font-size:14px; }
.crit-table { width:100%; border-collapse:collapse; font-size:13px; margin:10px 0; }
.crit-table th, .crit-table td { padding:8px 10px; border:1px solid #e0e0e0; text-align:left; vertical-align:top; }
.crit-table th { background:#1a2b5c; color:#fff; font-weight:600; font-size:12px; }
.crit-table tr:nth-child(even) { background:#f7f8fa; }
.crit-table tr.group td { background:#eef2fb !important; color:#1a2b5c; font-size:13px; }
.note { background:#fff8e1; border-left:4px solid #ffc107; padding:10px 14px; border-radius:6px; font-size:12px; color:#664d03; margin:10px 0; }
.check-card { background:#f8f9fb; border:1px solid #e8eaed; border-radius:8px; padding:14px 16px; margin:12px 0; }
.check-row { font-size:13px; margin:4px 0; }
.check-row b { color:#1a2b5c; }
ul { margin:6px 0 6px 20px; font-size:13px; }
li { margin:3px 0; }
code { background:#eef0f3; padding:1px 5px; border-radius:3px; font-size:12px; color:#b0006e; font-family:'SF Mono',Consolas,monospace; }
.lim-list { font-size:13px; }
.lim-list li { margin:6px 0; }
.badge { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; color:#fff; }
.badge.aem404 { background:#ea580c; } .badge.prod404 { background:#6366f1; }
.badge.both404 { background:#1f2937; } .badge.blocked { background:#7c3aed; }
.foot { margin-top:30px; padding-top:14px; border-top:1px solid #e0e0e0; color:#999; font-size:11px; text-align:center; }
.foot a { color:#1a2b5c; }
@media print { .panel { break-inside:avoid; } }
`;

main().catch(e => { console.error('❌', e); process.exit(1); });

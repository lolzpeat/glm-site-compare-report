// Build a standalone "Detection Criteria" documentation page.
// Output: output/criteria.html — deployed alongside the dashboard.

import { writeFile, mkdir } from 'node:fs/promises';
import { DIR, PASS_THRESHOLD, THAI_RATIO_DELTA, IMAGE_RATIO_TOLERANCE,
  TEXT_MATCH_TOLERANCE, MAX_LINK_CHECKS, LINK_CHECK_BATCH,
  WEIGHTS_MAIN, CRITERIA_GROUPS } from '../config.js';

async function main() {
  await mkdir(DIR.output, { recursive: true });
  const html = renderDoc();
  await writeFile(`${DIR.output}/criteria.html`, html, 'utf8');
  console.log(`✅ Criteria page → ${DIR.output}/criteria.html`);
}

function renderDoc() {
  const criteriaRows = CRITERIA_GROUPS.map(g => {
    const head = `<tr class="group"><td colspan="4"><b>${g.label}</b> — ${Math.round(g.weight * 100)}%</td></tr>`;
    const labels = {
      headerMenu:      ['Header menu (label + count)', 'count เท่ากัน + label 100%', 'header label + จำนวนเมนูต้องตรงกันทั้งหมด'],
      footerMenu:      ['Footer menu (label + count)', 'count เท่ากัน + label 100%', 'footer label + จำนวนเมนูต้องตรงกันทั้งหมด'],
      components:      ['Components (accordion/table/form/video)', 'แต่ละ type ≥ 80%', 'component แต่ละประเภทที่ prod มี AEM ต้องมีอย่างน้อย 80%'],
      contentLength:   ['Content length', 'AEM อยู่ใน ±' + Math.round(TEXT_MATCH_TOLERANCE * 100) + '% ของ prod', 'เทียบ textContent length — AEM สั้นหรือยาวเกิน ' + Math.round(TEXT_MATCH_TOLERANCE * 100) + '% ของ prod = fail'],
      missingText:     ['Missing text blocks', 'missing = 0', 'ประโยค/บล็อก text ของ prod ต้องมีใน AEM ครบ (กรอง dynamic content)'],
      missingKeywords: ['Missing keywords', 'missing = 0', 'คำสำคัญของ prod ต้องมีใน AEM'],
      missingImage:    ['Missing image', 'count ≥ 80% + alt match > 50%', 'AEM ต้องมีรูป ≥ 80% ของ prod และ alt text ตรงกัน > 50%'],
      headings:        ['Headings (Jaccard)', 'Jaccard > 0.6', 'เปรียบเทียบ heading text sets ด้วย Jaccard index'],
      links:           ['Links match', 'match > 50%', 'เปอร์เซ็นต์ของ link text ใน prod ที่พบใน AEM'],
      meta:            ['Meta tags', 'ทั้งหมดตรง (partial credit)', 'เทียบ title, description, canonical, og:title, og:image, keywords — ให้ partial credit'],
      thaiBalance:     ['Thai/English balance', 'delta ≤ ' + Math.round(THAI_RATIO_DELTA * 100) + '%', 'สัดส่วนอักขระไทย vs อังกฤษต้องใกล้เคียงกัน'],
    };
    const body = g.checks.map(id => {
      const [name, pass, desc] = labels[id] || [id, '', ''];
      return `<tr><td><b>${name}</b></td><td>${Math.round(WEIGHTS_MAIN[id] * 100)}%</td><td>${pass}</td><td>${desc}</td></tr>`;
    }).join('');
    return head + body;
  }).join('');

  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Detection Criteria — BBL Migration Parity Checker</title>
<style>${CSS}</style>
</head><body>
<nav class="topnav">
  <a href="dashboard.html">📊 Dashboard หลัก</a>
  <a href="news-dashboard.html">📰 News & Media</a>
  <a href="criteria.html" class="active">📋 เกณฑ์ตรวจจับ</a>
</nav>
<div class="wrap">

<header>
  <h1>📋 เกณฑ์ตรวจจับและวิธีการ</h1>
  <p class="meta">BBL Migration Parity Checker · อธิบายทุก check ที่เครื่องมือใช้ตรวจ + วิธีการ + เกณฑ์ผ่าน/ไม่ผ่าน</p>
</header>

<!-- ─── SCORING ─────────────────────────────────────────────────── -->
<section class="panel">
  <h2>1. การให้คะแนน Parity Score</h2>
  <p>แต่ละหน้าจะได้ <b>Parity Score (0–100%)</b> คำนวณจาก <b>11 checks ใน 3 groups</b> ผ่านเมื่อ <b>≥ ${PASS_THRESHOLD}%</b></p>
  <table class="crit-table">
    <thead><tr><th>Check</th><th>น้ำหนัก</th><th>เกณฑ์ผ่าน</th><th>วิธีคำนวณ</th></tr></thead>
    <tbody>
${criteriaRows}
    </tbody>
  </table>
  <div class="note">
    <b>Partial credit:</b> แม้ check ไม่ผ่าน ก็ยังได้คะแนนบางส่วนตามสัดส่วน (เช่น headings ที่ Jaccard 40% จะได้ 40% ของน้ำหนัก 25% = 10 คะแนน)
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
    <h3>🖼️ Image Distortion / Ratio</h3>
    <div class="check-row"><b>จุดประสงค์:</b> ตรวจจับรูปที่ถูกบีบ/ยืดผิดสัดส่วนหลัง migrate</div>
    <div class="check-row"><b>วิธีการ:</b> ดึง rendered dimensions (<code>getBoundingClientRect</code>) และ natural dimensions (<code>naturalWidth/Height</code>) ของทุกรูป จับคู่ prod↔AEM ด้วย filename ก่อน (เหลือจับคู่ตามลำดับ) แล้วเปรียบเทียบ aspect ratio</div>
    <div class="check-row"><b>เกณฑ์ flag:</b></div>
    <ul>
      <li><b>Ratio mismatch:</b> rendered aspect ratio ต่างกัน > ${Math.round(IMAGE_RATIO_TOLERANCE*100)}% → รูปถูกบิด</li>
      <li><b>New distortion:</b> AEM ที่ rendered ratio ≠ natural ratio (ถูกบีบ) แต่ prod ปกติ → distortion ใหม่ที่เกิดจาก migrate</li>
      <li><b>Missing images:</b> AEM มีรูปน้อยกว่า prod > 2 รูป → รูปหาย</li>
    </ul>
    <div class="note">หมายเหตุ: AEM เก็บรูปเป็น hash name (media_abc123...) ไม่ตรงกับ prod (logo.svg) — จึงต้องจับคู่ตามลำดับแทน filename เป็นหลัก</div>
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
  อัปเดตล่าสุด: ${new Date().toLocaleDateString('th-TH')} · <a href="dashboard.html">← กลับ Dashboard</a>
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

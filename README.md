# BBL Migration Parity Checker

เปรียบเทียบเว็บไซต์ Bangkok Bank ระหว่าง **Production** (Sitecore) กับ **AEM migrate**
เพื่อตรวจหาความต่างก่อน go-live — รองรับหลายร้อยหน้าพร้อม concurrent pipeline

🔗 **Live Dashboard:** https://glm-site-compare-report.vercel.app

## วิธีใช้

```bash
npm install                    # ติดตั้ง puppeteer-core + sharp (ครั้งเดียว)

# Main pages (632 หน้า)
npm run fetch                  # ดึง URL list จาก Google Sheet
npm run compare                # เทียบทุกหน้า (concurrent)
npm run dashboard              # สร้าง dashboard + drill-down pages
open output/dashboard.html     # ดูผล

# หรือรันทีเดียว:
npm run fetch && npm run compare && npm run dashboard
```

### News & Media Articles (แยก pipeline)

```bash
npm run fetch:news             # ดึง URL จาก News tab (gid=1728025962)
npm run compare:news           # เทียบด้วย news-specific criteria (concurrency 1 แนะนำ)
npm run dashboard              # build ทั้ง main + news dashboard
open output/news-dashboard.html
```

### ทดสอบจำกัดจำนวนหน้า

```bash
npm run fetch -- --limit=20
npm run compare -- --limit=20 --concurrency=4
npm run dashboard
```

## โครงสร้างไฟล์

```
site-compare-bbl/
├── config.js              # ปรับ concurrency, timeout, viewport, parity weights
├── vercel.json            # Vercel static deploy config (output/)
├── src/
│   ├── fetch-urls.js      # ดึง URL list จาก Google Sheet (--gid สำหรับ tab อื่น)
│   ├── extract.js         # ดึง DOM metrics (headings, links, text, images, news containers)
│   ├── compare.js         # pipeline หลัก (concurrent + parity scoring + resumable)
│   ├── build-dashboard.js # สร้าง dashboard + drill-down pages (--prefix สำหรับ news)
│   └── build-docs.js      # สร้างหน้า criteria.html (เอกสารเกณฑ์ตรวจจับ)
├── data/                  # (gitignored) URLs, results, screenshots
│   ├── urls.csv           # main URL list
│   ├── urls-news.csv      # news URL list
│   ├── results.json       # main results (632 pages)
│   ├── results-news.json  # news results
│   └── screenshots/{id}/  # prod.jpg + aem.jpg per page
└── output/                # deploy ขึ้น Vercel
    ├── index.html         # redirect → dashboard.html
    ├── dashboard.html     # main dashboard (632 pages)
    ├── news-dashboard.html# news dashboard
    ├── criteria.html      # เอกสารเกณฑ์ตรวจจับ
    ├── pages/             # main drill-down (1-632)
    ├── news-pages/        # news drill-down
    └── screenshots/       # screenshots (self-contained)
```

## Parity Score — Main Pages

คำนวณจาก weighted metrics (ปรับน้ำหนักได้ใน `config.js`):

| Check | Weight | เกณฑ์ผ่าน |
|---|---|---|
| Headings match | 25% | Jaccard similarity > 60% |
| Links match | 20% | > 50% ของ prod link-texts มีใน AEM |
| Content length | 15% | AEM อยู่ใน ±30% ของ prod |
| Meta tags | 15% | title + description + canonical + og + keywords ตรง |
| Accordions | 15% | จำนวนใกล้เคียง + ไม่มี accordion ว่าง |
| Header & Footer | 10% | มี nav/footer links |

ผ่านเมื่อ parity ≥ 85% (ปรับได้ใน `config.js` → `PASS_THRESHOLD`)

## Parity Score — News Articles (เฉพาะ)

News ใช้ criteria แยก (ปรับใน `config.js` → `WEIGHTS_NEWS`):

| Check | Weight | เกณฑ์ผ่าน |
|---|---|---|
| หัวข้อข่าว (Title) | 25% | `.text-large.text-light.pad-bot` (prod) ตรงกับ AEM |
| วันที่เผยแพร่ | 15% | publish date จาก container ต้องตรง |
| เนื้อหาข่าว | 30% | `modal-body.pad-bot` vs `news-media-details` — ratio ±30% |
| รูปประกอบ | 15% | จำนวนใกล้เคียง (≥70%) + alt text match |
| Breadcrumb + ปุ่มแชร์ | 15% | มีครบเหมือน prod |

## สถานะหน้า (Status Badges)

| Badge | สี | ความหมาย |
|---|---|---|
| PASS | เขียว | parity ≥ 85% |
| REVIEW | เหลือง | parity 50–84% |
| FAIL | แดง | parity < 50% |
| PROD 404 | ม่วง | production เป็น 404 — ไม่มีต้นฉบับ |
| AEM 404 | ส้ม | AEM ยังไม่ migrate หน้านี้ |
| BOTH 404 | ดำ | หายทั้งคู่ — URL อาจไม่มีอยู่จริง |
| BLOCKED | ม่วงเข้ม | โดน WAF/anti-bot block — re-capture ภายหลัง |

## ฟีเจอร์

- **Concurrent pipeline** — 4 workers ขนาน (main), 1 worker (news — หลีก WAF)
- **Resumable capture** — skip หน้าที่ capture แล้ว ไม่ต้องทำใหม่ (`--force` เพื่อบังคับ)
- **Re-score from cache** — แก้ logic แล้ว re-score ได้เร็วโดยไม่เปิด browser
- **Error detection** — 404, Access Denied (WAF), lazy-load timeout
- **Thai/Latin ratio** — ตรวจจับหน้าที่แสดงผิดภาษา
- **Broken link check** — in-browser fetch HTTP status
- **Image distortion** — rendered ratio + newly-introduced distortion
- **Dynamic block filter** — กรองวันที่/เลขที่เปลี่ยนทุกวันออกจาก content diff
- **Side-by-side screenshots** — synced scroll, resize 800px JPEG
- **Pagination + category filter** — 25/page, filter by category/sub-category/status
- **News-specific criteria** — เทียบเฉพาะ container ของข่าว (ไม่รวม nav/footer)
- **Vercel deploy** — push แล้ว auto-deploy ทันที

## CLI Flags

```bash
node src/compare.js [options]

Options:
  --limit=N              จำกัดจำนวนหน้า (N หน้าแรกจาก urls.csv)
  --ids=3,7,19-25        เจาะจงหน้าตาม id (คอมมา + range) — เช่น re-capture เฉพาะหน้าที่พัง
  --retry-failed         capture เฉพาะหน้าที่เคย fail มาก่อน (ไม่มี checks ใน results.json ปัจจุบัน)
  --concurrency=N        จำนวน workers ขนานกัน (default: 4)
  --force                บังคับ re-capture ทุกหน้า (ignore resume)
  --news                 ใช้ news-specific scoring criteria
  --urls=PATH            ไฟล์ URL list input (default: data/urls.csv)
  --output=PATH          ไฟล์ผลลัพธ์ (default: data/results.json)
  --source=PATH          ไฟล์ resume source (default: เดียวกับ output)
```

`--ids`/`--retry-failed`/`--limit` เลือกได้ทีละอย่าง (ลำดับความสำคัญ: `--ids` > `--retry-failed` >
`--limit`) หน้าที่อยู่นอก scope ของ run นั้นจะถูก **preserve** ไว้เหมือนเดิมเสมอ — ผลลัพธ์เก่าไม่มีวันหาย
แม้ re-run บางส่วนซ้ำหลายรอบ

## Sheet sync (เขียนผลกลับ Google Sheet)

เขียนผล validation กลับไปที่ Google Sheet (QA master file แยกจาก `SHEET_CSV_URL` — ต้องเป็น
**native Google Sheet**, ไม่ใช่ไฟล์ .xlsx ที่อัปโหลด เพราะ Sheets API เขียนไฟล์ Office ไม่ได้)
— คอลัมน์ `Automatiion Validation Status` + `Open Issues`. จับคู่แถวด้วย URL (column A) ไม่ใช่
ตำแหน่งแถว ดังนั้น sort/แทรกแถวใน sheet ไม่กระทบ sync.

`Automatiion Validation Status` นับ**รอบการรัน full report** (ตัวเลขเดียวกันทุกแถวในรอบเดียวกัน)
ไม่ใช่ pass/fail — **1st Validation** → **2nd Validation** → ... โดย increment **เฉพาะตอนที่ report
ทั้งหมดไป compare มาใหม่จริง ๆ** (ตรวจจาก `generatedAt` ใน results.json เทียบกับค่าที่บันทึกไว้ใน
`data/sync-state.json` ตอน sync ครั้งล่าสุด) — รัน `sync-sheet.js` ซ้ำกับ results.json ชุดเดิม
(generatedAt ไม่เปลี่ยน) จะไม่เพิ่มรอบ ทุกแถวยังเป็นเลขเดิม อัปเดตแค่ `Open Issues`.

`Open Issues` สรุปเป็นภาษาไทยแบบกระชับ — เช็คที่ไม่ผ่านสูงสุด `SYNC_ISSUES_MAX` รายการ (ปรับได้ใน
config.js) คั่นด้วย comma เช่น `เมนูบนไม่ครบ, ลิงก์ขาด, เนื้อหาไม่ครบ +5 รายการ`

```bash
node src/sync-sheet.js --dry-run       # ดูค่าที่จะเขียน โดยไม่เขียนจริง
node src/sync-sheet.js                 # sync data/results.json → sheet
node src/sync-sheet.js --limit=5       # sync แค่ N แถวแรกที่จับคู่ได้
node src/sync-sheet.js --source=data/results-news.json
```

ต้องมี **service-account key** ที่ `.secrets/sheet-sync-key.json` (gitignored) และ share sheet
ให้ service account นั้นเป็น **Editor** (ไม่ใช่แค่ Viewer) — ไม่งั้น batchUpdate จะ fail ด้วย 403.
ปรับ spreadsheet ID / gid / คอลัมน์เป้าหมายได้ใน `config.js` (`SYNC_*`).

## ข้อกำหนด

- Node.js 18+
- Chrome/Chromium (puppeteer-core จะหา binary อัตโนมัติใน cache)
- Google Sheet ต้องเป็น public (anyone with link)

## Deploy

อัปเดต dashboard บน Vercel:
```bash
npm run dashboard         # build output/
git add output/ && git commit -m "update dashboard" && git push
```

Vercel จะ auto-deploy จาก `output/` directory (ตั้งค่าใน `vercel.json`)

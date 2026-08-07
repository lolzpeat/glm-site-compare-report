# สเปก: เพิ่ม pipeline "categorized" (dashboard หน้าใหม่)

- **โปรเจกต์:** BBL Migration Parity Checker
- **วันที่:** 7 สิงหาคม 2026
- **Branch:** `feat/criteria-v2`

## เป้าหมาย

เพิ่ม dashboard หน้าใหม่จาก sheet tab **"Priority TH Pages - Categorized"**
(gid 269089346) โดยใช้ pipeline เทียบ parity แบบเดียวกับหน้า priority — capture
จริง, ให้คะแนน v2, มี screenshot เทียบและ drill-down ครบ

Spreadsheet เดียวกับที่ใช้อยู่ (`SYNC_SPREADSHEET_ID`) service account จึงเข้าถึงได้แล้ว

## ข้อมูลต้นทาง

37 แถวที่กรอกจริง (จาก 403 แถวที่จองไว้) ทุกแถวมีทั้ง prod URL และ AEM URL

| คอลัมน์ | ค่า |
|---|---|
| Category | Personal 31 · Business Banking 6 |
| Sub-Category | 9 หมวด (My Family & Me 9, Cards 8, Manage My Business 6, …) |
| Fix & Update Status | Done (with Known issue) 26 · Done 4 · Waiting Componant TH Page 3 · Processing 3 · Done (with Condition) 1 |

**ขอบเขต: 31 หน้า** — เอาเฉพาะที่แก้เสร็จแล้ว (`Done` + `Done (with Known issue)` +
`Done (with Condition)`) ตัด `Processing` และ `Waiting Componant TH Page` ออก
เพราะยังแก้ไม่เสร็จ เทียบไปก็เจอ gap ที่รู้อยู่แล้ว

## ส่วนที่ 1 — Generalize fetch script

`fetch-priority-urls.js` เพิ่งได้ logic ป้องกัน id เลื่อน (~130 บรรทัด) การ copy
ไปทำ tab ใหม่แปลว่าครั้งหน้าที่แก้บั๊กต้องแก้สองที่ และมันคือ logic ที่พลาดแล้ว
คะแนนทั้งชุดไปผูกผิด URL — จึงเปลี่ยนเป็นขับด้วย config

`src/fetch-priority-urls.js` → `src/fetch-sheet-urls.js --pipeline=<name>`

```js
// config.js
export const SHEET_PIPELINES = {
  priority: {
    tab: 'Priority BBL Thai Manual Pages',
    firstDataRow: 3,
    cols: { prod: 0, aem: 1, category: 3, subCategory: 4, status: 5 },
    statusFilter: ['Done'],
    conditionalStatus: ['Done (with Known issue)', 'Done with Condition'],
    conditionalLimit: Infinity,
    urlsPath: join(DIR.data, 'urls-priority.csv'),
  },
  categorized: {
    tab: 'Priority TH Pages - Categorized',
    firstDataRow: 4,
    cols: { prod: 0, aem: 1, category: 3, subCategory: 4, status: 7 },
    statusFilter: ['Done'],
    conditionalStatus: ['Done (with Known issue)', 'Done (with Condition)'],
    conditionalLimit: Infinity,
    urlsPath: join(DIR.data, 'urls-categorized.csv'),
  },
};
```

### สองจุดที่ต่างกันจริงและพลาดง่าย

1. **คอลัมน์ status ไม่ตรงกัน** — priority ใช้ **F** (index 5, หัวคอลัมน์ "Status")
   ส่วน categorized ใช้ **H** (index 7, "Fix & Update Status") คอลัมน์ F ของ tab
   ใหม่คือ "Automation Validation Status" ซึ่งเป็นตัวนับรอบ ไม่ใช่สถานะงาน
   ถ้าอ่านผิดคอลัมน์จะได้ "1st Validation" ทั้ง 37 แถวแล้วไม่มีแถวไหนผ่าน filter เลย

2. **ชื่อสถานะสะกดต่างกัน** — priority เขียน `Done with Condition` (ไม่มีวงเล็บ)
   categorized เขียน `Done (with Condition)` (มีวงเล็บ) ต้องแยกตาม pipeline
   ห้ามยุบเป็น list เดียว

### แถวข้อมูลเริ่มคนละแถว

priority: row 1 ว่าง · row 2 header · data จาก row 3
categorized: row 1 title · row 2 ว่าง · row 3 header · data จาก row 4

### สิ่งที่ต้องคงไว้ครบ

logic id stability ทั้งหมดที่มีอยู่ต้องทำงานเหมือนเดิมกับทั้งสอง pipeline:
แถวเดิมคงตำแหน่ง · แถวใหม่ต่อท้าย · **แถวที่หลุดเกณฑ์ถูก retain ไม่ถูกลบ** ·
`--prune` เป็นทางเลือกที่ต้องสั่งเอง · ไฟล์ปิดท้ายด้วย newline

`PRIORITY_*` ถูกใช้ที่เดียวคือสคริปต์นี้ (ตรวจแล้ว) การ generalize จึงไม่กระทบใคร

## ส่วนที่ 2 — ที่เหลือไม่ต้องเขียนโค้ดใหม่

ทุก script รับ flag อยู่แล้ว:

```bash
npm run fetch:categorized
node src/compare.js --urls=data/urls-categorized.csv \
  --output=data/results-categorized.json --shots-dir=data/screenshots/categorized
node src/layout-profile.js --source=data/results-categorized.json
node src/rescore.js --source=data/results-categorized.json --out=data/results-categorized.json
node src/sync-meta.js --urls=data/urls-categorized.csv --source=data/results-categorized.json
node src/build-dashboard.js --source=data/results-categorized.json --prefix=categorized --criteria=v2
```

`--prefix=categorized` ทำให้ได้ `output/categorized-dashboard.html`,
`output/categorized-pages/`, `output/categorized-screenshots/` โดยอัตโนมัติ

## ส่วนที่ 3 — เมนู

`src/nav.js` เพิ่ม 1 รายการ (ตอนนี้มี Priority / News / เกณฑ์ตรวจจับ)

## ส่วนที่ 4 — Capture

31 หน้า ที่จังหวะปลอดภัย **3–4 หน้า / พัก 20–30 นาที** ≈ 8–10 รอบ ≈ **4 ชั่วโมง**

จังหวะนี้พิสูจน์แล้วเมื่อ 6–7 ส.ค. ว่าผ่าน ส่วน 4 หน้า/พัก 3–5 นาที โดนบล็อก
ที่หน้าที่ 8 — ตัวชี้ขาดคือช่วงพักต้องยาวพอเคลียร์ sliding window ~15 นาที
ต้อง probe ก่อนทุก chunk และ abort ถ้าโดนบล็อกตั้งแต่ครึ่ง chunk

**หลัง capture ต้องรัน `rescore` ก่อน `build-dashboard`** — `compare.js` ให้คะแนน
ด้วย WEIGHTS v1 ถ้าข้ามจะแสดงคะแนน v1 ใต้ label v2
และต้องรัน `sync-meta` ด้วยเพราะ `compare.js` เขียน category แบบดิบ ไม่แปลง `-`

## การตรวจสอบ

| # | ตรวจ | เกณฑ์ผ่าน |
|---|---|---|
| 1 | `fetch:priority` หลัง refactor | CSV 91 แถวเท่าเดิม ทุก id ชี้ URL เดิม ไม่มีอะไรขยับ |
| 2 | `fetch:categorized` | ได้ 31 แถว · status ถูกอ่านจากคอลัมน์ H |
| 3 | id stability ของ pipeline ใหม่ | รัน fetch ซ้ำ ผลเหมือนเดิมทุกบรรทัด |
| 4 | retention ยังทำงาน | จำลองแถวที่ไม่มีใน sheet แล้วต้องถูก retain |
| 5 | Dashboard | ไฟล์ `categorized-*` ถูกสร้าง · filter category/sub-category มีค่า · ไม่มีตัวเลือก `-` |
| 6 | Regression | dashboard priority + news ยัง build ได้ · nav มีครบ 4 รายการ |

## นอกขอบเขต

- ไม่แตะ `compare.js`, `build-dashboard.js`, `rescore.js`, `sync-meta.js`
- ไม่แตะ dashboard priority / news ที่มีอยู่
- ไม่ดึงคอลัมน์ QA อื่น (Adobe Issue, Authur by, Done Date) เข้า dashboard — ถ้าต้องการเป็นงานแยก
- ไม่แตะ `sync-sheet.js` (เขียนกลับ sheet คนละเรื่อง)

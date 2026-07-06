# BBL Migration Parity Checker

เปรียบเทียบเว็บไซต์ Bangkok Bank ระหว่าง **Production** (Sitecore) กับ **AEM migrate**
เพื่อตรวจหาความต่างก่อน go-live — รองรับหลายร้อยหน้าพร้อม concurrent pipeline

## วิธีใช้

```bash
cd bbl-compare
npm install                    # ติดตั้ง puppeteer-core + sharp (ครั้งเดียว)

npm run fetch                  # ดึง URL list จาก Google Sheet
npm run compare                # เทียบทุกหน้า (concurrent)
npm run dashboard              # สร้าง dashboard + drill-down pages
open output/dashboard.html     # ดูผล

# หรือรันทีเดียว:
npm run fetch && npm run compare && npm run dashboard
```

### ทดสอบจำกัดจำนวนหน้า

```bash
npm run fetch -- --limit=20     # ดึงแค่ 20 หน้าแรก
npm run compare -- --limit=20 --concurrency=4
npm run dashboard
```

## โครงสร้างไฟล์

```
bbl-compare/
├── config.js              # ปรับ concurrency, timeout, viewport, parity weights
├── src/
│   ├── fetch-urls.js      # ดึง URL list จาก Google Sheet (col A↔B)
│   ├── extract.js         # ดึง DOM metrics (headings, links, text, accordions)
│   ├── compare.js         # pipeline หลัก (concurrent + parity scoring)
│   └── build-dashboard.js # สร้าง dashboard + drill-down pages
├── data/                  # (gitignored) URLs, results, screenshots
│   ├── urls.csv
│   ├── results.json
│   └── screenshots/{id}/prod.jpg, aem.jpg
└── output/                # (gitignored) dashboard.html + pages/{id}.html
```

## Parity Score

คำนวณจาก weighted metrics (ปรับน้ำหนักได้ใน `config.js`):

| Check | Weight | เกณฑ์ผ่าน |
|---|---|---|
| Headings match | 25% | Jaccard > 60% |
| Links match | 20% | > 50% ของ prod link-texts มีใน AEM |
| Content length | 15% | AEM อยู่ใน ±30% ของ prod |
| Meta tags | 15% | title + description + canonical + og + keywords ตรง |
| Accordions | 15% | จำนวนใกล้เคียง + ไม่มี accordion ว่าง |
| Header & Footer | 10% | มี nav/footer links |

ผ่านเมื่อ parity ≥ 85% (ปรับได้ใน `config.js` → `PASS_THRESHOLD`)

## ข้อกำหนด

- Node.js 18+
- Chrome/Chromium (puppeteer-core จะหา binary อัตโนมัติใน cache)
- Google Sheet ต้องเป็น public (任何人 with link ก็ได้)

# 🚀 Learning API — Frontend Dev Track

บันทึกการเรียนรู้ API ตั้งแต่ foundation → Express → (Phase 2) Next.js

## 📚 โครงสร้าง

- `PROGRESS.md` — ติดตามความคืบหน้า
- `docs/weeks/week-N.md` — เนื้อหารายสัปดาห์
- `docs/weeks/code/` — starter code อ้างอิง

## 🛠️ Prerequisites

- [Node.js](https://nodejs.org/) (v18+ แนะนำ)
- [VS Code](https://code.visualstudio.com/)
- Extension: **Thunder Client** (ทดสอบ API)

## 🗓️ แผน 8 สัปดาห์ (Phase 1)

| สัปดาห์ | ชื่อ |
|--------|------|
| 1 | The full picture |
| 2 | Request & URL deep dive |
| 3 | Response & JSON |
| 4 | Async JS gap-filler |
| 5 | Error handling & UX |
| 6 | Building your own API |
| 7 | POST & data in/out |
| 8 | Capstone |

เริ่ม: **30 มิ.ย. 2026**

## 📖 Spec

ดู design เต็มที่ `docs/superpowers/specs/2026-06-30-learning-api-design.md`

## 🌐 ดูเนื้อหาเป็นเว็บ (HTML)

เนื้อหาทุกหน้าแปลงเป็น HTML สวยๆ พร้อม sidebar นำทาง อ่านง่ายใน browser:

```bash
cd tools && npm install      # ครั้งแรกเท่านั้น
cd .. && node tools/build-html.js   # build → ได้โฟลเดอร์ site/
```

แล้วเปิด `site/index.html` ใน browser

> แก้ `.md` แล้วรัน `node tools/build-html.js` ใหม่ก็อัปเดต — `site/` ถูก `.gitignore` (เป็น output generated ไม่ต้อง commit)

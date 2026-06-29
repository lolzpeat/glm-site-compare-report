# สัปดาห์ 8 — Capstone

> เป้าหมายสัปดาห์นี้: รวมทุกอย่างเป็น project เดียวที่ portfolio-ready + แตะ auth/CORS เบื้องต้น

---

## 🎯 Learning objectives

- [ ] ออกแบบ API endpoint เองจาก requirement
- [ ] รวม GET + POST + error handling + async ใน project เดียว
- [ ] เข้าใจ CORS คืออะไร และทำไม browser บล็อก
- [ ] (แตะ) เข้าใจแนวคิด authentication เบื้องต้น (token/API key)

---

## ① Concept

### CORS (Cross-Origin Resource Sharing)

browser บล็อกการเรียก API ข้าม origin (เช่น frontend ที่ `localhost:5500` เรียก API ที่ `localhost:3000`) เพื่อความปลอดภัย. ต้องให้ server ส่ง header `Access-Control-Allow-Origin` เพื่ออนุญาต

```javascript
const cors = require('cors'); // npm install cors
app.use(cors());              // อนุญาตทุก origin (dev เท่านั้น)
```

> ⚠️ ถ้าเคยเจอ error "CORS policy blocked" — นี่คือเหตุผล

### Authentication เบื้องต้น (แค่แนวคิด)

- **API key:** ฝั่ง client ส่ง key ใน header → server ตรวจ
- **Token (JWT):** login → ได้ token → แนบ token ทุก request

(สัปดาห์นี้ไม่ implement เต็ม — แค่ให้เห็นภาพ ปูทาง Phase 2)

---

## ② Mini-build: Capstone project

เลือกหนึ่งในสอง (หรือคิดเอง):

### ตัวเลือก A — "Quote manager" (ต่อ week 6–7)
- Express server: GET list, POST add, DELETE, GET by id
- Frontend: ฟอร์ม + รายการ + ปุ่มลบ
- เปิด CORS (เผื่อ frontend ฝั่งอื่น)
- Bonus: persist ลงไฟล์ JSON (แทน in-memory array)

### ตัวเลือก B — "Weather + notes"
- ใช้ Open-Meteo (consuming) + Express server เก็บโน้ต (building)
- Frontend: แสดงสภาพอากาศ + บันทึกโน้ตต่อวัน
- รวมทั้งฝั่ง consuming และ building

### ข้อกำหนดร่วม (ทั้งสองตัวเลือก)

- ✅ ใช้ `async/await` ทั้งฝั่ง client
- ✅ มี loading + error state
- ✅ มี validation ฝั่ง server
- ✅ ใช้ git ตลอด (commit บ่อยๆ)
- ✅ มี `README.md` อธิบายวิธีรัน
- ✅ (optional) deploy ด้วย [Render](https://render.com) หรือ [Railway](https://railway.app) — เป็น portfolio จริง

---

## ③ Concept check

1. CORS บล็อกอะไร และทำไม?
2. ทำไมใช้ `app.use(cors())` ใน dev ได้ แต่ production ต้องระวัง?
3. API key กับ JWT token ต่างกันยังไง (เบื้องต้น)?
4. สรุปสิ่งที่คุณเรียนรู้ทั้ง 8 สัปดาห์เป็น 3 ประโยค

---

## 🏢 Office bridge

> 🎉 ตอนนี้คุณเข้าใจทั้งฝั่ง client และฝั่ง server แล้ว — ทุกอย่างที่ Next.js ทำให้ คุณรู้แล้วว่า "มาแทนอะไร". คราวหน้าที่เปิด Next.js ที่ออฟฟิศ คุณจะมองเห็น fetch, async/await, Response.json, routing, error/loading states ที่ Next.js ห่อไว้ — ทั้งหมดคือสิ่งที่คุณเขียนเองมาแล้ว. **นี่คือจุดเปลี่ยนจาก copy-paste developer → นักพัฒนาที่เข้าใจจริง**
>
> พร้อมแล้วใช่ไหม? → Phase 2: Next.js (เร่ง เพราะเคยผ่านมาแล้ว)

---

## 📚 ทรัพยากร

- [cors middleware (npm)](https://expressjs.com/en/resources/middleware/cors.html)
- [CORS — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Render](https://render.com) / [Railway](https://railway.app) — deploy ฟรี

---

## 🏁 เสร็จ Phase 1!

- [ ] เติม reflection ใน `PROGRESS.md` (อะไรยากที่สุด / คลิกที่สุด / อยากทบทวน)
- [ ] Commit สุดท้าย: `git add -A && git commit -m "feat(week8): capstone project complete — Phase 1 done"`
- [ ] (ถ้า deploy) ใส่ลิงก์ demo ใน `README.md`
- [ ] ตอบ concept check 4 ข้อ

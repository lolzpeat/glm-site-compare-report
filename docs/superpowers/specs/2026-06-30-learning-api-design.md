# Design Spec: Learning API (Frontend Dev Track)

**ผู้เรียน:** Frontend developer (รู้ HTML/CSS + JS fundamentals)
**เริ่ม:** 30 มิ.ย. 2026
**Commitment:** Casual (~2–3 ชม./สัปดาห์), open-ended
**เป้าหมาย:** (C) ใช้ Next.js ที่ออฟฟิศได้จริง + (D) เข้าใจ mental model ของ API

---

## 1. บริบทผู้เรียน

- **ทักษะปัจจุบัน:** HTML/CSS (มั่นใจ) + JS fundamentals (variables, functions, control flow, loops — ใช้ได้)
- **ช่องว่าง:** ไม่คุ้น async JS (Promise, `async/await`, `fetch`) — จะเก็บควบไปกับเรื่อง API
- **สภาพแวดล้อมการทำงาน:** ใช้ Next.js ที่ออฟฟิศทุกวัน แต่เข้าใจผิวๆ (copy-paste developer) — พอเจอ bug แก้ไม่ได้
- **สไตล์การเรียน:** Concept first, then practice (อธิบาย mental model ก่อน → ค่อยลงมือ)
- **การส่งมอบเนื้อหา:** ไฟล์ markdown เป็นหลัก + กลับมาถามเป็นจังหวะเมื่อติด/สงสัย (interactive)

### กฎการเขียนเนื้อหา (ทั้งแผน)

| ส่วน | ภาษา |
|------|------|
| **Prose (คำอธิบาย)** | ไทย + technical terms ภาษาอังกฤษ |
| **Code comment** | ภาษาอังกฤษใน code block (เหมือนงานจริง) |
| **คำอธิบายเสริมนอก code** | ไทย |

---

## 2. Mental Model แกนกลาง (concept anchor)

ภาพในหัวที่ทุกอาทิตย์เจาะลึกจาก:

```
[ Browser / JS ของเรา ]  --request (ขอข้อมูล)-->  [ API server ]
        ^                                            |
        |                                            |
        +----response (ส่งข้อมูลกลับมาเป็น JSON)------+
```

**5 ไอเดียที่ทำให้ "API" คลิก:**

1. **API = menu ร้านอาหาร** — บอกว่า *ขออะไรได้บ้าง* และ *ขอยังไง* ส่วนครัว (server) มองไม่เห็น
2. **Request = คำถามที่มีส่วนประกอบ** — method (GET/POST), URL, headers, body (optional)
3. **Response = คำตอบที่มีส่วนประกอบ** — status code, headers, body (มักเป็น JSON)
4. **JSON = ภาษากลาง** — string หน้าตาเหมือน JS object; frontend แปลงด้วย `JSON.parse()` หรือให้ `fetch` ทำให้
5. **Async เพราะ network ช้า** — Promise / async-await: "ไปทำให้หน่อย พอได้คำตอบ *แล้ว* ค่อยทำขั้นต่อไป"

---

## 3. แนวทาง: Concept-anchored spiral

อาทิตย์ 1 สร้างสิ่งเล็กๆ end-to-end (server + client) เพื่อให้ภาพรวมคลิกทันที → แต่ละอาทิตย์ต่อไปเจาะลึกทีละชั้น

**ทำไมเลือกแนวทางนี้:** ตอบโจทย์ทั้ง 2 เป้า — ภาพรวมตั้งแต่วันแรก (D) + ค่อยๆ ลึกจน job-ready (C) — และแต่ละอาทิตย์เป็นอิสระเหมาะกับ casual pace

**ทำไมไม่ใช่ Next.js ตั้งแต่ต้น:** Next.js ซ่อน 5 ชั้นไว้ข้างหลัง (server, routing, API, React, hydration) เริ่มจากมันเลยจะ "ใช้เป็นแต่ไม่เข้าใจ" → พอเจอ bug แก้ไม่ได้ (ซึ่งคือสภาพปัจจุบันที่ออฟฟิศ) ต้องเห็นชั้นพื้นฐานก่อน

---

## 4. โครงสร้าง 8 สัปดาห์ (Phase 1)

ทุกอาทิตย์มี 3 ส่วนเสมอ: **① Concept → ② Mini-build → ③ Concept check** + **🏢 Office bridge** (เชื่อมกับ Next.js ที่ออฟฟิศ)

| สัปดาห์ | ชื่อ | เจาะลึก | Mini-build |
|--------|------|---------|------------|
| **1** | The full picture | ภาพรวม end-to-end ทั้งหมด | 10 บรรทัด Express server + client แสดงผล |
| **2** | Request & URL deep dive | method, URL structure, path/query params, headers | client เรียก public API พร้อม parameter |
| **3** | Response & JSON | status code ทั้งชุด, JSON ซับซ้อน, parse | dashboard จาก public API จริง |
| **4** | Async JS gap-filler | Promise, `.then`/`.catch`, async/await | refactor code อาทิตย์ 3 → async/await |
| **5** | Error handling & UX | try/catch, network error, loading state | แสดง loading + error message |
| **6** | Building your own API | Node + Express, route, ส่ง JSON กลับ | สร้าง quotes/jokes API ของตัวเอง |
| **7** | POST & data in/out | POST body, validation เบื้องต้น | ฟอร์ม → POST → เก็บ/แสดง |
| **8** | Capstone | รวมทุกอย่าง + แตะ auth/CORS | mini-project portfolio-ready |

**หลักการ:** อาทิตย์ 1–5 = ฝั่ง consuming (priority), อาทิตย์ 6–8 = ฝั่ง building. อาทิตย์ 4 แทรกกลางเพราะ async JS จำเป็นตั้งแต่อาทิตย์ 2–3 แต่เก็บลึกทีหลัง (ก่อนหน้านั้นใช้ `.then` เป็นแพทเทิร์นชั่วคราว).

### 🏢 Office bridge — ตัวอย่างการเชื่อม

- **สัปดาห์ 1:** "ใน Next.js คุณไม่เห็นบรรทัด server เหล่านี้เลย — Next.js สร้าง server ให้อัตโนมัติ นี่คือเหตุผลที่คุณไม่เข้าใจว่ามันทำงานยังไง"
- **สัปดาห์ 3:** "Next.js API route ก็ส่ง JSON กลับเหมือนกัน แค่ห่อในไฟล์ `route.ts`"
- **สัปดาห์ 4:** "นี่คือสิ่งที่คุณเขียนใน Next.js Server Component ทุกวัน แต่ไม่รู้ว่ามันคืออะไร"

---

## 5. Tech Stack

| เครื่องมือ | ใช้ทำอะไร | เหตุผล |
|----------|----------|-------|
| **Express** | server framework (ฝั่ง building) | de facto ตลาดงาน Node, tutorial/คำตอบเยอะที่สุด |
| **Node.js + npm** | รัน server, ติดตั้ง package | จำเป็นทุกทาง |
| **Vanilla JS** (ฝั่ง client) | เรียก API, จัดการ DOM | ใช้สกิลที่มีอยู่ เห็นทุกบรรทัดทำงาน (ไม่ซ่อนด้วย React) |
| **VS Code** | editor | frontend dev คุ้นเคย |
| **Thunder Client** (VS Code ext) | ทดสอบ API แยกจาก browser | ฝึก "เรียก API โดยไม่ต้องเขียน UI ก่อน" |
| **Public APIs ฟรี** | ฝึก consuming (สัปดาห์ 2–3) | JSONPlaceholder, Open-Meteo (สภาพอากาศ) |
| **git** | version control + portfolio log | ทุก mini-build commit เป็นผลงาน |

---

## 6. Progress Tracker

- **รูปแบบ:** `PROGRESS.md` ใน repo (markdown checklist)
- **วันเริ่ม:** 30 มิ.ย. 2026 (จะใส่วันที่จริงตลอด 8 สัปดาห์)
- **โครงสร้าง (B — overview + weekly detail):**
  1. **Overview table** — 8 สัปดาห์ + checkbox + วันที่เริ่ม/เสร็จ + ชั่วโมง
  2. **Weekly detail** — ทุกอาทิตย์ขยายเป็น checklist ①②③ + ช่องโน้ตส่วนตัว
- **Bonus 🅱️ (trigger เมื่อสกิลพอ):** ~สัปดาห์ 5–6 เสนอโจทย์ "เอา tracker markdown มาทำเป็นหน้าเว็บ HTML/CSS/JS" เป็น reinforcement exercise

---

## 7. รูปแบบเนื้อหารายสัปดาห์ (template)

ทุก `week-N.md` มีโครงสร้างเดียวกัน:

```
# Week N — <ชื่อ>
## 🎯 Learning objectives (สิ่งที่ทำได้หลังเรียน — วัดได้)
## ① Concept
## ② Mini-build (ขั้นตอน + code)
## ③ Concept check (4 คำถามเปิด)
## 🏢 Office bridge (เชื่อมกับ Next.js ที่ออฟฟิศ)
## 📚 ทรัพยากร (URL เฉพาะ)
```

**ตัวอย่าง detail เต็มของสัปดาห์ 1** — ดูไฟล์ `week-1.md` ในขั้น implementation (ทุกสัปดาห์จะ detail ระดับเดียวกัน).

---

## 8. Phase 2 — Modern Stack (Next.js) — roadmap พรีวิว

หลังจบ Phase 1, ไม่ได้ detail เท่า เพราะยังไกล:

1. **React essentials** — component, props, state, hooks (เร่ง — เคยผ่านมาบ้าง)
2. **Next.js foundation** — ทุก feature ของ Next.js จะ "คลิก" เพราะรู้ว่ามันมาแทนอะไรจาก Phase 1
3. **เน้นส่วนที่ใช้ที่ออฟฟิศจริง** — API routes, data fetching, server/client components
4. **เป้า:** เข้าใจ Next.js ที่ทำงานจริงๆ → แก้ bug ได้ → หลุดจาก copy-paste developer

---

## 9. ขอบเขต (scope) — สิ่งที่จะทำ / ไม่ทำ

**จะทำ:**
- สร้าง repo + git + `.gitignore` + `PROGRESS.md`
- ไฟล์ `week-1.md` ถึง `week-8.md` (Phase 1) — concept + mini-build + concept check + office bridge
- โค้ด starter/ตัวอย่างของแต่ละสัปดาห์
- ทรัพยากร/URL เฉพาะเจาะจง (จะ search ในขั้น plan)

**จะไม่ทำ (YAGNI):**
- ไม่สอน React/Next.js ใน Phase 1 (เก็บไว้ Phase 2)
- ไม่ detail Phase 2 ใน spec นี้
- ไม่สร้าง content ก่อนได้รับ approval (ทำทีละสัปดาห์ตามจังหวะผู้เรียน)

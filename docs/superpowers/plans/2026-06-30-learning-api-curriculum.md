# API Learning Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง repo + tracker + ไฟล์เนื้อหา 8 สัปดาห์ (Phase 1) สำหรับเรียนรู้ API ตั้งแต่ foundation จนใช้ Express เขียน API เองได้

**Architecture:** Concept-anchored spiral — สัปดาห์ 1 สร้างสิ่งเล็ก end-to-end (server + client) แล้วแต่ละสัปดาห์เจาะลึกทีละชั้น. Tech: Express (server) + vanilla JS (client) + git (portfolio). ทุกสัปดาห์มี ① Concept → ② Mini-build → ③ Concept check → 🏢 Office bridge.

**Tech Stack:** Node.js, Express, vanilla JS (fetch/Promise/async-await), git, VS Code + Thunder Client

**Spec:** `docs/superpowers/specs/2026-06-30-learning-api-design.md`

---

## File Structure

| ไฟล์ | หน้าที่ |
|------|--------|
| `README.md` | แนะนำโปรเจกต์ + วิธีใช้ + โครงสร้าง |
| `.gitignore` | ไม่เก็บ `node_modules/` ฯลฯ |
| `PROGRESS.md` | Tracker — overview table + weekly detail (ภาษาไทย) |
| `docs/weeks/week-1.md` ถึง `week-8.md` | เนื้อหารายสัปดาห์ (concept + build + check + office bridge) |
| `docs/weeks/code/` | starter code แต่ละสัปดาห์ (เก็บเป็น reference) |

**หลักการ:** แต่ละไฟล์มีหน้าที่เดียวชัดเจน — content แยกจาก code, tracker แยกจาก concept. ไฟล์เปลี่ยนพร้อมกัน (เช่น code ของสัปดาห์) อยู่ใกล้กัน.

---

## Task 0: Project bootstrap (repo + tracker)

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/.gitignore`
- Create: `/Users/prapon.t/ZCodeProject/README.md`
- Create: `/Users/prapon.t/ZCodeProject/PROGRESS.md`

- [ ] **Step 1: ตรวจสอบ Node.js ติดตั้งแล้ว**

Run: `node --version && npm --version`
Expected: เลข version (เช่น `v20.x.x` / `10.x.x`). ถ้าไม่มี → ให้ผู้เรียนติดตั้งจาก nodejs.org ก่อนทำต่อ

- [ ] **Step 2: เริ่มต้น git repo**

Run: `git init && git branch -M main`
Expected: `Initialized empty Git repository`

- [ ] **Step 3: สร้าง `.gitignore`**

Create `/Users/prapon.t/ZCodeProject/.gitignore`:

```
# Dependencies
node_modules/

# Logs
*.log
npm-debug.log*

# OS
.DS_Store

# Env
.env
.env.local
```

- [ ] **Step 4: สร้าง `README.md`**

Create `/Users/prapon.t/ZCodeProject/README.md`:

````markdown
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
````

- [ ] **Step 5: สร้าง `PROGRESS.md` (tracker)**

Create `/Users/prapon.t/ZCodeProject/PROGRESS.md`:

````markdown
# 📊 Progress Tracker

เริ่ม: **30 มิ.ย. 2026** · เป้า ~2–3 ชม./สัปดาห์

## Overview

| ✅ | สัปดาห์ | ชื่อ | เริ่ม | เสร็จ | ชม. |
|----|--------|------|------|------|-----|
| [ ] | 1 | The full picture | 30/06/2026 | __/__/____ | __ |
| [ ] | 2 | Request & URL deep dive | 07/07/2026 | __/__/____ | __ |
| [ ] | 3 | Response & JSON | 14/07/2026 | __/__/____ | __ |
| [ ] | 4 | Async JS gap-filler | 21/07/2026 | __/__/____ | __ |
| [ ] | 5 | Error handling & UX | 28/07/2026 | __/__/____ | __ |
| [ ] | 6 | Building your own API | 04/08/2026 | __/__/____ | __ |
| [ ] | 7 | POST & data in/out | 11/08/2026 | __/__/____ | __ |
| [ ] | 8 | Capstone | 18/08/2026 | __/__/____ | __ |

---

## Weekly Detail

### สัปดาห์ 1 — The full picture
- [ ] ① Concept: อ่าน mental model (request→server→response→JSON→render)
- [ ] ② Mini-build: 10 บรรทัด Express server + client แสดงผล
- [ ] ③ Concept check: ตอบ 4 คำถามท้ายสัปดาห์
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 2 — Request & URL deep dive
- [ ] ① Concept: method, URL structure, path/query params, headers
- [ ] ② Mini-build: client เรียก public API พร้อม parameter
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 3 — Response & JSON
- [ ] ① Concept: status code ทั้งชุด, JSON ซับซ้อน, parse
- [ ] ② Mini-build: dashboard จาก public API จริง
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 4 — Async JS gap-filler
- [ ] ① Concept: Promise, `.then`/`.catch`, async/await
- [ ] ② Mini-build: refactor code สัปดาห์ 3 → async/await
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 5 — Error handling & UX
- [ ] ① Concept: try/catch, network error, loading state
- [ ] ② Mini-build: แสดง loading + error message
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 6 — Building your own API
- [ ] ① Concept: Node + Express, route, ส่ง JSON กลับ
- [ ] ② Mini-build: สร้าง quotes/jokes API ของตัวเอง
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 7 — POST & data in/out
- [ ] ① Concept: POST body, validation เบื้องต้น
- [ ] ② Mini-build: ฟอร์ม → POST → เก็บ/แสดง
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

### สัปดาห์ 8 — Capstone
- [ ] ① Concept: รวมทุกอย่าง + แตะ auth/CORS
- [ ] ② Mini-build: mini-project portfolio-ready
- [ ] ③ Concept check: ตอบ 4 คำถาม
- **สิ่งที่สร้างได้:** ___________________
- **จุดที่ติด/สงสัย:** ___________________

---

## 🪞 Reflection (เติมตอนจบ)

- **อะไรยากที่สุด:** ___________________
- **อะไรคลิกที่สุด:** ___________________
- **อยากทบทวนอะไร:** ___________________

---

## 💡 Bonus (trigger ~สัปดาห์ 5–6)

เมื่อสกิลพอ → เอา tracker markdown นี้มาทำเป็นหน้าเว็บ HTML/CSS/JS (ฝึกสกิลที่เรียนไปแบบ reinforcement)

- [ ] Bonus: HTML tracker page
````

- [ ] **Step 6: สร้างโฟลเดอร์โครงสร้าง**

Run: `mkdir -p docs/weeks/code`
Expected: สร้างโฟลเดอร์ `docs/weeks/code`

- [ ] **Step 7: Commit bootstrap**

Run: `git add -A && git commit -m "chore: bootstrap repo + progress tracker"`
Expected: commit สำเร็จ

---

## Task 1: สัปดาห์ 1 — The full picture

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-1.md`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-1/server.js`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-1/public/index.html`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-1/public/script.js`

- [ ] **Step 1: เขียน `docs/weeks/week-1.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-1.md`:

````markdown
# สัปดาห์ 1 — The full picture

> เป้าหมายสัปดาห์นี้: เห็นวงจรเต็ม (server ↔ client) ทำงานจริงในมือคุณ ภายในสัปดาห์เดียว

---

## 🎯 Learning objectives

หลังเรียนสัปดาห์นี้ คุณทำได้ว่า:
- [ ] อธิบายภาพ request → server → response → render ด้วยภาษาตัวเอง
- [ ] ระบุส่วนประกอบของ request (method, URL) และ response (status code, body)
- [ ] รัน Express server และเรียกจาก browser ได้
- [ ] อ่าน JSON response และนำค่าไปแสดงใน HTML

---

## ① Concept

### Mental model ที่ต้องถนัด

```
[ Browser / JS ของเรา ]  --request (ขอข้อมูล)-->  [ API server ]
        ^                                            |
        |                                            |
        +----response (ส่งข้อมูลกลับมาเป็น JSON)------+
```

### คำศัพท์ที่ต้องจำ

| คำ | ความหมาย |
|----|---------|
| **API** | เมนู — รายการสิ่งที่ขอได้ + วิธีขอ |
| **endpoint** | 1 จุดในเมนู (URL เช่น `/api/hello`) |
| **request** | คำขอที่ส่งออกไป |
| **response** | คำตอบที่ได้กลับมา |
| **JSON** | รูปแบบข้อมูล text ที่หน้าตาเหมือน JS object |
| **status code** | เลขบอกว่า request สำเร็จไหม (200 = ok, 404 = ไม่พบ) |

### HTTP method (2 ตัวก่อน)

- **GET** = ขอข้อมูล (อ่าน)
- **POST** = ส่งข้อมูลเข้าไป (เขียน) — เจอจริงในสัปดาห์ 7

---

## ② Mini-build: "Hello API"

### 2.1 เตรียมโฟลเดอร์

```bash
cd docs/weeks/code/week-1
npm init -y
npm install express
```

### 2.2 สร้าง server (`server.js`)

```javascript
// server.js — 10 บรรทัด: Express server ที่ส่ง JSON กลับ
const express = require('express');
const app = express();

// GET endpoint ที่ path "/api/hello"
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from API!' }); // send JSON response
});

// Start server on port 3000
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
```

### 2.3 รัน server

```bash
node server.js
```
ทดสอบ: เปิด browser ไปที่ `http://localhost:3000/api/hello` → เห็น `{"message":"Hello from API!"}`

### 2.4 สร้าง client ฝั่ง browser

`public/index.html`:

```html
<!-- index.html — หน้าเว็บที่เรียก API แล้วแสดงผล -->
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Hello API</title></head>
<body>
  <h1>Message from API:</h1>
  <p id="output">Loading...</p>
  <script src="script.js"></script>
</body>
</html>
```

`public/script.js`:

```javascript
// script.js — เรียก API แล้วแสดงผลในหน้าเว็บ
fetch('/api/hello')                    // send GET request
  .then(response => response.json())  // parse JSON body
  .then(data => {
    document.getElementById('output').textContent = data.message; // render
  });
```

เพิ่มบรรทัดนี้ใน `server.js` ก่อน `app.listen` เพื่อให้ server เสิร์ฟหน้าเว็บด้วย:

```javascript
// Serve static files from "public" folder
app.use(express.static('public'));
```

เปิด `http://localhost:3000` → เห็นข้อความ "Hello from API!" แสดงในหน้าเว็บ ✅

---

## ③ Concept check (ตอบก่อนไปสัปดาห์ต่อไป)

1. request กับ response ต่างกันยังไง?
2. ทำไมต้องมี status code? (ลองนึกถึงตอนเจอ 404)
3. JSON ต่างจาก JS object ธรรมดายังไง?
4. ถ้า network ช้า โค้ดเราจะมีปัญหาอะไร? (สงสัยไว้ก่อน → ตอบในสัปดาห์ 4–5)

---

## 🏢 Office bridge

> ใน Next.js คุณไม่เห็นบรรทัด server เหล่านี้เลย — Next.js สร้าง server ให้อัตโนมัติ นี่คือเหตุผลที่คุณใช้ Next.js ทุกวันแต่ไม่เข้าใจว่ามันทำงานยังไง สัปดาห์นี้คุณเห็น "เครื่องจักร" ด้วยตาตัวเองแล้ว

---

## 📚 ทรัพยากร

- [Express Hello World](https://expressjs.com/en/5x/starter/hello-world/) — คู่มือทางการ
- [Express/Node Introduction — MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/Introduction) — บริบท "Node คืออะไร Express คืออะไร"
- [Using the Fetch API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch) — สำหรับฝั่ง client

---

## ✅ เสร็จสัปดาห์นี้แล้ว?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 1
- [ ] Commit งาน: `git add -A && git commit -m "feat(week1): hello API server + client"`
- [ ] ตอบ concept check 4 ข้อ (เขียนคำตอบใน notebook หรือที่ปรึกาส่วนตัว)
````

- [ ] **Step 2: สร้าง starter code files (reference)**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-1/server.js`:

```javascript
// server.js — 10 บรรทัด: Express server ที่ส่ง JSON กลับ
const express = require('express');
const app = express();

// GET endpoint ที่ path "/api/hello"
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from API!' }); // send JSON response
});

// Serve static files from "public" folder
app.use(express.static('public'));

// Start server on port 3000
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
```

Create `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-1/public/index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Hello API</title></head>
<body>
  <h1>Message from API:</h1>
  <p id="output">Loading...</p>
  <script src="script.js"></script>
</body>
</html>
```

Create `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-1/public/script.js`:

```javascript
// script.js — เรียก API แล้วแสดงผลในหน้าเว็บ
fetch('/api/hello')                    // send GET request
  .then(response => response.json())  // parse JSON body
  .then(data => {
    document.getElementById('output').textContent = data.message; // render
  });
```

- [ ] **Step 3: Commit**

Run: `git add -A && git commit -m "feat(week1): the full picture — concept + mini-build + code"`
Expected: commit สำเร็จ

---

## Task 2: สัปดาห์ 2 — Request & URL deep dive

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-2.md`

- [ ] **Step 1: เขียน `docs/weeks/week-2.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-2.md`:

````markdown
# สัปดาห์ 2 — Request & URL deep dive

> เป้าหมายสัปดาห์นี้: ควบคุม request ให้ได้ — เลือก method, ส่ง parameter, เข้าใจ headers

---

## 🎯 Learning objectives

- [ ] อธิบายส่วนประกอบของ URL (protocol, host, path, query)
- [ ] ใช้ path parameter และ query parameter แตกต่างกันได้
- [ ] เข้าใจว่า headers คืออะไร และ Content-Type ทำงานยังไง
- [ ] สร้าง client ที่เรียก public API พร้อม parameter

---

## ① Concept

### ส่วนประกอบของ URL

```
https://api.example.com/users/42/posts?limit=10&sort=desc
\___/   \_______________/ \_________/ \__________________/
protocol      host            path         query string
```

- **path parameter** (`/users/42`) = ระบุ *ว่าเป็น resource ตัวไหน* (เฉพาะเจาะจง)
- **query parameter** (`?limit=10&sort=desc`) = *กรอง/ปรับ* ผลลัพธ์ (เสริม)

### HTTP method ยกชุด

| Method | ใช้ทำอะไร | เปรียบเทียบ |
|--------|----------|------------|
| **GET** | อ่านข้อมูล | "ขอดูเมนู" |
| **POST** | สร้างใหม่ | "สั่งเพิ่ม" |
| **PUT/PATCH** | แก้ไข | "เปลี่ยนแปลง" |
| **DELETE** | ลบ | "ยกเลิก" |

### Headers = metadata ของ request/response

เช่น `Content-Type: application/json` = "ข้อมูลที่ส่ง/รับเป็น JSON" — เป็นสัญญาว่าทั้งสองฝั่งจะแปลข้อมูลยังไง

---

## ② Mini-build: เรียก public API พร้อม parameter

ใช้ **JSONPlaceholder** (free fake API, ไม่ต้องสมัคร)

### 2.1 ทดสอบใน Thunder Client ก่อน (ฝึกสกิลจริง)

1. ติดตั้ง extension **Thunder Client** ใน VS Code
2. สร้าง request: `GET https://jsonplaceholder.typicode.com/users/1`
   - ลองเปลี่ยน path param: `/users/2`, `/users/5`
3. สร้าง request: `GET https://jsonplaceholder.typicode.com/posts?userId=1`
   - ลองเปลี่ยน query: `?userId=2&_limit=3`

### 2.2 สร้าง client ที่เรียก API จริง

สร้างไฟล์ใหม่ใน `docs/weeks/code/week-2/` (หรือโฟลเดอร์ที่คุณเลือก):

`index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>User Lookup</title></head>
<body>
  <h1>ค้นหา user</h1>
  <input id="userId" type="number" value="1" min="1">
  <button id="search">ค้นหา</button>
  <pre id="output">ผลลัพธ์จะแสดงที่นี่</pre>
  <script src="script.js"></script>
</body>
</html>
```

`script.js`:

```javascript
// script.js — ดึงข้อมูล user ตาม path parameter
const button = document.getElementById('search');
const output = document.getElementById('output');

button.addEventListener('click', () => {
  const id = document.getElementById('userId').value;
  const url = `https://jsonplaceholder.typicode.com/users/${id}`; // path param

  fetch(url)
    .then(response => response.json())
    .then(user => {
      output.textContent = JSON.stringify(user, null, 2); // pretty-print JSON
    });
});
```

> 💡 ไม่ต้องรัน server — เปิดไฟล์ HTML ตรงๆ ใน browser ได้เลย (เรียก API ภายนอก)

---

## ③ Concept check

1. path parameter กับ query parameter ควรใช้ต่างกันยังไง? (อันไหนระบุตัวเฉพาะ อันไหนกรอง?)
2. `Content-Type: application/json` บอกอะไรกับ server?
3. `GET` กับ `POST` ต่างกันยังไง นอกจากชื่อ?
4. ทำไม JSONPlaceholder ถึงเรียกว่า "fake" API?

---

## 🏢 Office bridge

> ใน Next.js เวลาคุณเรียก API (เช่น `fetch('/api/users')` ใน client component) มันคือ GET request เหมือนกันเป๊ะ — ต่างแค่ path เป็น route ของ Next.js เอง. สิ่งที่คุณเรียนสัปดาห์นี้คือสิ่งที่ Next.js ทำใต้ฝาโผล่ออกมาให้เห็น.

---

## 📚 ทรัพยากร

- [HTTP request methods — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods)
- [JSONPlaceholder](https://jsonplaceholder.typicode.com/) — free fake API
- [Thunder Client (VS Code)](https://www.thunderclient.com/) — ทดสอบ API

---

## ✅ เสร็จสัปดาห์นี้?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 2
- [ ] Commit: `git add -A && git commit -m "feat(week2): request & URL deep dive"`
- [ ] ตอบ concept check 4 ข้อ
````

- [ ] **Step 2: Commit**

Run: `git add -A && git commit -m "feat(week2): request & URL deep dive — concept + mini-build"`
Expected: commit สำเร็จ

---

## Task 3: สัปดาห์ 3 — Response & JSON

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-3.md`

- [ ] **Step 1: เขียน `docs/weeks/week-3.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-3.md`:

````markdown
# สัปดาห์ 3 — Response & JSON

> เป้าหมายสัปดาห์นี้: อ่าน response ออก, เข้าใจ status code ทั้งชุด, จัดการ JSON ซับซ้อน

---

## 🎯 Learning objectives

- [ ] ระบุความหมายของ status code แต่ละ class (1xx–5xx)
- [ ] parse JSON ที่ซ้อนกัน (nested) และเป็น array ได้
- [ ] แยกแยะ `response.status`, `response.ok`, `response.json()` ได้
- [ ] สร้าง dashboard ที่ดึงและแสดงข้อมูลจาก API จริง

---

## ① Concept

### Status code ทั้งชุด (5 class)

| Class | ช่วง | ใจความ | ตัวอย่าง |
|-------|------|--------|---------|
| 1xx | 100–199 | Informational (ระหว่างดำเนิน) | หายาก |
| 2xx | 200–299 | **Success** ✅ | 200 OK, 201 Created |
| 3xx | 300–399 | Redirection (ไปดูที่อื่น) | 301, 304 |
| 4xx | 400–499 | **Client error** (ฝั่งเราผิด) | 400, 401, 403, 404 |
| 5xx | 500–599 | **Server error** (ฝั่งเขาพัง) | 500, 502, 503 |

> 💡 `response.ok` = `true` เมื่อ status อยู่ใน 200–299 — เป็น shortcut ที่ใช้บ่อย

### JSON ซ้อนกัน (nested)

```json
{
  "user": {
    "name": "Ada",
    "address": {
      "city": "London"
    }
  },
  "posts": [
    { "title": "Hello" },
    { "title": "World" }
  ]
}
```

เข้าถึง: `data.user.address.city` → `"London"`, `data.posts[0].title` → `"Hello"`

### ขั้นตอน parse response ฝั่ง client

```javascript
fetch(url)
  .then(response => {
    // response.status  → เลข เช่น 200
    // response.ok      → true/false
    return response.json();  // คืน Promise ของ parsed JSON
  })
  .then(data => {
    // data คือ JS object จริงแล้ว — ใช้งานได้เลย
  });
```

---

## ② Mini-build: Weather dashboard

ใช้ **Open-Meteo** (free, ไม่ต้อง API key)

`index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Weather Dashboard</title></head>
<body>
  <h1>สภาพอากาศ — กรุงเทพฯ (13.75, 100.50)</h1>
  <p>อุณหภูมิ: <span id="temp">Loading...</span>°C</p>
  <p>ลม: <span id="wind">--</span> km/h</p>
  <p>Status: <span id="status">--</span></p>
  <script src="script.js"></script>
</body>
</html>
```

`script.js`:

```javascript
// script.js — ดึงข้อมูลจาก Open-Meteo แล้วแสดง
const url = 'https://api.open-meteo.com/v1/forecast?latitude=13.75&longitude=100.50&current=temperature_2m,wind_speed_10m';

fetch(url)
  .then(response => {
    document.getElementById('status').textContent = response.status; // show status code
    if (!response.ok) {
      throw new Error('Request failed: ' + response.status);
    }
    return response.json();
  })
  .then(data => {
    // JSON ที่ได้ซ้อนกัน: data.current.temperature_2m
    document.getElementById('temp').textContent = data.current.temperature_2m;
    document.getElementById('wind').textContent = data.current.wind_speed_10m;
  });
```

เปิดใน browser → เห็นสภาพอากาศจริงของกรุงเทพฯ ✅

---

## ③ Concept check

1. status code `200`, `404`, `500` แต่ละตัวแปลว่าอะไร?
2. ทำไมต้องเช็ค `response.ok` ทั้งที่ fetch ไม่ throw error?
3. ถ้า JSON มี array ข้างใน เราวนลูปแสดงยังไง?
4. `response.json()` คืนค่าอะไรออกมา (object เลย หรือ Promise)?

---

## 🏢 Office bridge

> ใน Next.js API route (`app/api/.../route.ts`) คุณก็ส่ง `Response.json({...}, { status: 200 })` กลับเหมือนกันเป๊ะ — ตัว `Response` นั้นคือ Web API เดียวกับ `fetch` ฝั่ง client. ฝั่งรับก็ทำ `const data = await response.json()` เหมือนกัน. สัปดาห์นี้ทำให้คุณเห็นว่าสองฝั่งใช้ภาษาเดียวกัน.

---

## 📚 ทรัพยากร

- [HTTP response status codes — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status)
- [Response.json() — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Response/json)
- [Open-Meteo](https://open-meteo.com/) — free weather API (no key)

---

## ✅ เสร็จสัปดาห์นี้?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 3
- [ ] Commit: `git add -A && git commit -m "feat(week3): response & JSON dashboard"`
- [ ] ตอบ concept check 4 ข้อ
````

- [ ] **Step 2: Commit**

Run: `git add -A && git commit -m "feat(week3): response & JSON — concept + mini-build"`
Expected: commit สำเร็จ

---

## Task 4: สัปดาห์ 4 — Async JS gap-filler

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-4.md`

- [ ] **Step 1: เขียน `docs/weeks/week-4.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-4.md`:

````markdown
# สัปดาห์ 4 — Async JS gap-filler

> เป้าหมายสัปดาห์นี้: ปิดช่องว่าง JS ที่ค้าง — เข้าใจ Promise, `.then`/`.catch`, และ `async/await` จนใช้ได้สบาย

---

## 🎯 Learning objectives

- [ ] อธิบายว่า Promise คืออะไร และทำไม network request ต้องใช้มัน
- [ ] อ่าน/เขียน `.then().catch()` ได้
- [ ] แปลงโค้ด `.then()` เป็น `async/await` ได้
- [ ] เข้าใจว่าทำไมต้องมี `try/catch` กับ `async/await`

---

## ① Concept

### ทำไมต้อง async?

Network request ใช้เวลา — ถ้า JS รอตอบโดยไม่ทำอย่างอื่น หน้าเว็บจะค้าง. JS ใช้ **Promise**: "สัญญาว่าจะมีค่ากลับมา *ในอนาคต* — บอกฉันทีว่าจะทำอะไรเมื่อถึงเวลา"

### Promise lifecycle

```
Pending (รอ) → Fulfilled (สำเร็จ, มีค่า) 
            ↘ Rejected (ล้มเหลว, มี error)
```

### 3 สไตล์การเขียน (วิวัฒนาการ)

**สไตล์ 1 — `.then()` (เก่า, เจอบ่อยใน codebase)**:
```javascript
fetch(url)
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error(error));
```

**สไตล์ 2 — `async/await` (modern, อ่านง่ายกว่า)**:
```javascript
async function getData() {
  try {
    const response = await fetch(url);     // รอตรงนี้
    const data = await response.json();    // รอต่อ
    console.log(data);
  } catch (error) {
    console.error(error);
  }
}
```

### กฎเหล็ก

- `await` ใช้ได้แค่ในฟังก์ชันที่มีคำว่า `async` นำหน้า
- `await` = "หยุดรอบรรทัดนี้จนเสร็จ แล้วค่อยไปต่อ" (แต่ไม่บล็อกหน้าเว็บ)
- error ใน `async` ต้องจับด้วย `try/catch` (เทียบเท่า `.catch()`)

---

## ② Mini-build: refactor สัปดาห์ 3 เป็น async/await

เปิด `script.js` ของสัปดาห์ 3 แล้วแปลงจาก `.then()` → `async/await`:

```javascript
// script.js (refactored) — async/await แทน .then()
async function loadWeather() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=13.75&longitude=100.50&current=temperature_2m,wind_speed_10m';

  try {
    const response = await fetch(url);
    document.getElementById('status').textContent = response.status;

    if (!response.ok) {
      throw new Error('Request failed: ' + response.status);
    }

    const data = await response.json();   // await แทน .then()
    document.getElementById('temp').textContent = data.current.temperature_2m;
    document.getElementById('wind').textContent = data.current.wind_speed_10m;
  } catch (error) {
    console.error('Failed to load weather:', error);
  }
}

loadWeather(); // เรียกใช้
```

เปรียบเทียบสองเวอร์ชันทีละบรรทัด — สังเกตว่าอ่านตามลำดับบนลงล่างแบบ async/await เหมือนโค้ดธรรมดามากขึ้น

---

## ③ Concept check

1. ทำไมต้องใช้ Promise ทั้งที่เขียน sync ง่ายกว่า?
2. `.catch()` ใน `.then()` เทียบเท่ากับอะไรใน `async/await`?
3. ถ้าลืมใส่ `async` ข้างหน้าฟังก์ชันที่มี `await` จะเกิดอะไรขึ้น?
4. `await` "บล็อก" หน้าเว็บไหม? (ลองอธิบายให้คนไม่ใช่โปรแกรมเมอร์ฟัง)

---

## 🏢 Office bridge

> นี่คือสิ่งที่คุณเขียนใน Next.js Server Component ทุกวัน — `async function Page() { const data = await fetch(...); }`. ตอนนี้คุณรู้แล้วว่า `async/await` มาจากไหน และทำไมต้องมี `async` นำหน้า. คราวหน้าที่เจอ Server Component ที่ออฟฟิศ คุณจะอ่านออกและแก้ได้ ไม่ใช่ copy-paste อีกต่อไป.

---

## 📚 ทรัพยากร

- [Using Promises — MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
- [async function — MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
- [Making network requests with JavaScript — MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Network_requests)

---

## ✅ เสร็จสัปดาห์นี้?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 4
- [ ] Commit: `git add -A && git commit -m "feat(week4): async JS refactor to async/await"`
- [ ] ตอบ concept check 4 ข้อ
````

- [ ] **Step 2: Commit**

Run: `git add -A && git commit -m "feat(week4): async JS gap-filler — concept + refactor"`
Expected: commit สำเร็จ

---

## Task 5: สัปดาห์ 5 — Error handling & UX

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-5.md`

- [ ] **Step 1: เขียน `docs/weeks/week-5.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-5.md`:

````markdown
# สัปดาห์ 5 — Error handling & UX

> เป้าหมายสัปดาห์นี้: ทำให้ app ทนทาน — จัด loading state, จับ error ทุกแบบ, แสดงให้ผู้ใช้เห็น

---

## 🎯 Learning objectives

- [ ] แยกประเภท error: network error vs status error vs parse error
- [ ] ใช้ `try/catch` ครอบ async code ได้
- [ ] แสดง loading state ตอนรอ และซ่อนตอนเสร็จ
- [ ] ออกแบบ error message ที่เป็นมิตรกับผู้ใช้

---

## ① Concept

### 3 ประเภท error ที่ต้องรู้

| ประเภท | เกิดเมื่อไร | จับยังไง |
|--------|-----------|---------|
| **Network error** | ไม่มีเน็ต / server ล่ม / CORS | `fetch` reject → `catch` |
| **Status error** (4xx/5xx) | server ตอบกลับ แต่ไม่ success | เช็ค `response.ok` แล้ว throw |
| **Parse error** | response ไม่ใช่ JSON ที่ถูกต้อง | `response.json()` reject → `catch` |

> ⚠️ **สำคัญ:** `fetch` ไม่ throw ตอนเจอ 404/500 — มันถือว่า "ได้ response แล้ว" ต้องเช็ค `response.ok` เอง

### Loading state = สัญญาณให้ผู้ใช้

ผู้ใช้ต้องรู้ว่า app กำลังทำงานอยู่ (ไม่ใช่ค้าง). แสดง "Loading..." ทันทีที่เริ่ม request แล้วซ่อนตอนเสร็จ/พัง.

---

## ② Mini-build: loading + error UI

`index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Weather (robust)</title></head>
<body>
  <h1>สภาพอากาศ</h1>
  <div id="loading" hidden>Loading...</div>
  <div id="error" hidden style="color:red"></div>
  <div id="result" hidden>
    <p>อุณหภูมิ: <span id="temp">--</span>°C</p>
  </div>
  <button id="retry" hidden>ลองอีกครั้ง</button>
  <script src="script.js"></script>
</body>
</html>
```

`script.js`:

```javascript
// script.js — จัด loading + error + result states
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const resultEl = document.getElementById('result');

async function loadWeather() {
  // Reset: show loading, hide others
  loadingEl.hidden = false;
  errorEl.hidden = true;
  resultEl.hidden = true;

  const url = 'https://api.open-meteo.com/v1/forecast?latitude=13.75&longitude=100.50&current=temperature_2m';

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // Status error — แปลงให้เป็น throw เพื่อเข้า catch
      throw new Error(`Server error: ${response.status}`);
    }

    const data = await response.json();

    // Success — show result
    document.getElementById('temp').textContent = data.current.temperature_2m;
    resultEl.hidden = false;

  } catch (error) {
    // Network error OR status error OR parse error — มาถึงที่นี่หมด
    errorEl.textContent = 'ไม่สามารถดึงข้อมูลได้: ' + error.message;
    errorEl.hidden = false;
    document.getElementById('retry').hidden = false;

  } finally {
    // ทุกกรณี — ซ่อน loading
    loadingEl.hidden = true;
  }
}

document.getElementById('retry').addEventListener('click', loadWeather);
loadWeather(); // เริ่มครั้งแรก
```

ทดสอบ error path: เปลี่ยน URL ให้ผิด (เช่นเพิ่มตัวอักษร) → เห็น error message + ปุ่ม retry

---

## ③ Concept check

1. ทำไม `fetch` ไม่ throw เมื่อเจอ 404?
2. ความต่างระหว่าง network error กับ status error คืออะไร?
3. `finally` ทำงานเมื่อไร? ทำไมใช้ซ่อน loading?
4. ถ้าไม่มี loading state ผู้ใช้จะรู้สึกยังไง?

---

## 🏢 Office bridge

> ใน Next.js คุณเคยเจอ `loading.tsx` และ `error.tsx` ไหม? นั่นคือ Next.js ทำสิ่งเดียวกันที่คุณเขียนสัปดาห์นี้ — แค่ห่อเป็นไฟล์ convention ให้อัตโนมัติ. พอเข้าใจสัปดาห์นี้ คุณจะรู้ว่า Next.js ทำอะไรให้ข้างหลัง และจะปรับแต่งมันได้.

---

## 📚 ทรัพยากร

- [try...catch — MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch)
- [Response.ok — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Response/ok)
- [Using Fetch: Checking that the fetch was successful — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#checking_that_the_fetch_was_successful)

---

## 💡 Bonus trigger

ถ้าสัปดาห์นี้คุณรู้สึกว่า "เริ่มคล่องแล้ว" → นี่คือจุดที่เหมาะจะลอง **bonus 🅱️**: เอา `PROGRESS.md` มาทำเป็นหน้าเว็บ tracker HTML/CSS/JS (ใช้สกิลที่เรียนมาทั้งหมด)

---

## ✅ เสร็จสัปดาห์นี้?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 5
- [ ] Commit: `git add -A && git commit -m "feat(week5): error handling & UX states"`
- [ ] ตอบ concept check 4 ข้อ
````

- [ ] **Step 2: Commit**

Run: `git add -A && git commit -m "feat(week5): error handling & UX — concept + mini-build"`
Expected: commit สำเร็จ

---

## Task 6: สัปดาห์ 6 — Building your own API

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-6.md`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-6/server.js`

- [ ] **Step 1: เขียน `docs/weeks/week-6.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-6.md`:

````markdown
# สัปดาห์ 6 — Building your own API

> เป้าหมายสัปดาห์นี้: เปลี่ยนฝั่ง! จากคนเรียก API → คนสร้าง API. สร้าง quotes/jokes API ของตัวเอง

---

## 🎯 Learning objectives

- [ ] อธิบายส่วนประกอบของ Express app (route, handler, response)
- [ ] สร้างหลาย endpoint ใน server เดียว
- [ ] ส่ง JSON กลับพร้อม status code ที่ถูกต้อง
- [ ] ทดสอบ API ของตัวเองด้วย Thunder Client

---

## ① Concept

### สิ่งที่ server ต้องทำ (เมื่อรับ request)

```
รับ request → ดู method + path → หา handler ที่ตรง → ทำงาน → ส่ง response
```

Express ช่วยตรง "หา handler ที่ตรง" ด้วย **routing**: `app.get('/path', handler)`

### โครงสร้าง Express handler

```javascript
app.get('/path', (req, res) => {
  // req = ข้อมูล request ที่เข้ามา
  // res = เครื่องมือส่ง response กลับ
  res.json({ ... });       // ส่ง JSON (status 200 อัตโนมัติ)
  res.status(404).json(...); // เปลี่ยน status code
});
```

### REST convention (แบบง่าย)

| Endpoint | Method | ทำอะไร |
|----------|--------|--------|
| `/api/quotes` | GET | ดูคำคมทั้งหมด |
| `/api/quotes/random` | GET | ดูคำคมสุ่ม |
| `/api/quotes/:id` | GET | ดูคำคมตาม id |

---

## ② Mini-build: Quotes API

`server.js`:

```javascript
// server.js — Quotes API ของเราเอง
const express = require('express');
const app = express();

// In-memory data (เก็บใน RAM, รีสตาร์ตแล้วหาย)
const quotes = [
  { id: 1, text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
  { id: 2, text: 'Simplicity is the soul of efficiency.', author: 'Austin Freeman' },
  { id: 3, text: 'Code is like humor. When you have to explain it, it\'s bad.', author: 'Cory House' },
];

// GET all quotes
app.get('/api/quotes', (req, res) => {
  res.json(quotes);
});

// GET random quote
app.get('/api/quotes/random', (req, res) => {
  const random = quotes[Math.floor(Math.random() * quotes.length)];
  res.json(random);
});

// GET quote by id (path parameter)
app.get('/api/quotes/:id', (req, res) => {
  const id = Number(req.params.id); // path param เป็น string, แปลงเป็น number
  const quote = quotes.find(q => q.id === id);

  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' }); // หาไม่เจอ
  }
  res.json(quote);
});

app.listen(3000, () => console.log('Quotes API at http://localhost:3000'));
```

### ทดสอบใน Thunder Client

1. `GET http://localhost:3000/api/quotes` → เห็น array 3 รายการ
2. `GET http://localhost:3000/api/quotes/random` → คำคมสุ่ม
3. `GET http://localhost:3000/api/quotes/1` → คำคม id 1
4. `GET http://localhost:3000/api/quotes/99` → `404` + error message

---

## ③ Concept check

1. `req` กับ `res` ทำหน้าที่อะไรใน handler?
2. ทำไมต้องแปลง `req.params.id` จาก string เป็น number?
3. ทำไม endpoint `/api/quotes/random` ต้องอยู่ก่อน `/api/quotes/:id`?
4. ข้อมูลเก็บใน array (in-memory) มีข้อจำกัดอะไร? (ลองคิดเรื่องรีสตาร์ต)

---

## 🏢 Office bridge

> ใน Next.js API route คุณเขียน handler ในไฟล์ `app/api/quotes/route.ts` แบบนี้: `export async function GET() { return Response.json(quotes); }`. สังเกตว่ามันคือสิ่งเดียวกัน — `GET` handler + `Response.json`. ต่างแค่ Next.js จัด routing ให้ตามโครงไฟล์ แทนที่จะเขียน `app.get(...)` เอง. ตอนนี้คุณรู้แล้วว่ามันห่ออะไรซ่อนไว้.

---

## 📚 ทรัพยากร

- [Express routing](https://expressjs.com/en/guide/routing.html)
- [Express Hello World](https://expressjs.com/en/5x/starter/hello-world/)
- [Express/Node Introduction — MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/Introduction)

---

## ✅ เสร็จสัปดาห์นี้?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 6
- [ ] Commit: `git add -A && git commit -m "feat(week6): build quotes API with Express"`
- [ ] ตอบ concept check 4 ข้อ
````

- [ ] **Step 2: สร้าง starter code reference**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-6/server.js` (copy เนื้อหาจากด้านบนใน week-6.md)

- [ ] **Step 3: Commit**

Run: `git add -A && git commit -m "feat(week6): building your own API — concept + quotes server"`
Expected: commit สำเร็จ

---

## Task 7: สัปดาห์ 7 — POST & data in/out

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-7.md`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-7/server.js`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-7/public/index.html`
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-7/public/script.js`

- [ ] **Step 1: เขียน `docs/weeks/week-7.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-7.md`:

````markdown
# สัปดาห์ 7 — POST & data in/out

> เป้าหมายสัปดาห์นี้: ปิดวงจร — ผู้ใช้กรอกฟอร์ม → POST ไป server → server เก็บ → แสดงผล

---

## 🎯 Learning objectives

- [ ] อธิบายความต่าง GET vs POST ในแง่การส่งข้อมูล
- [ ] ใช้ `express.json()` middleware เพื่ออ่าน request body
- [ ] ส่ง POST request จาก client พร้อม JSON body
- [ ] ทำ validation เบื้องต้น (เช็ค field ที่จำเป็น)

---

## ① Concept

### POST = ส่งข้อมูลเข้า server

ต่างจาก GET (ที่ข้อมูลอยู่ใน URL) — POST ส่งข้อมูลใน **request body**, เหมาะกับข้อมูลเยอะ/ละเอียด

### Request body ทางฝั่ง client

```javascript
fetch('/api/quotes', {
  method: 'POST',                          // ระบุ method
  headers: { 'Content-Type': 'application/json' }, // บอกว่าส่ง JSON
  body: JSON.stringify({ text: '...', author: '...' }) // แปลง object → JSON string
});
```

### อ่าน body ทางฝั่ง server

Express ไม่อ่าน body อัตโนมัติ ต้องเปิดด้วย middleware:

```javascript
app.use(express.json()); // ทำให้ req.body ใช้ได้ (เป็น object)

app.post('/api/quotes', (req, res) => {
  const newQuote = req.body; // ได้เป็น object แล้ว
  // ...เก็บ...
  res.status(201).json(newQuote); // 201 = Created
});
```

### Validation เบื้องต้น

เช็คก่อนเก็บ: field ที่จำเป็นมีครบไหม? ถ้าไม่ → ส่ง `400 Bad Request`

---

## ② Mini-build: ฟอร์มเพิ่มคำคม

ต่อจาก Quotes API สัปดาห์ 6 — เพิ่ม POST endpoint + ฟอร์ม

`server.js` (เพิ่มจาก week-6):

```javascript
const express = require('express');
const app = express();
app.use(express.json());       // ⭐ ต้องมี — อ่าน JSON body
app.use(express.static('public'));

const quotes = [
  { id: 1, text: 'The best way to predict the future is to invent it.', author: 'Alan Kay' },
];

let nextId = 2;

// GET all
app.get('/api/quotes', (req, res) => res.json(quotes));

// POST — รับคำคมใหม่
app.post('/api/quotes', (req, res) => {
  const { text, author } = req.body;

  // Validation: ต้องมีทั้ง text และ author
  if (!text || !author) {
    return res.status(400).json({ error: 'text and author are required' });
  }

  const newQuote = { id: nextId++, text, author };
  quotes.push(newQuote);
  res.status(201).json(newQuote); // 201 Created
});

app.listen(3000, () => console.log('Server at http://localhost:3000'));
```

`public/index.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Add Quote</title></head>
<body>
  <h1>เพิ่มคำคม</h1>
  <form id="quoteForm">
    <input id="text" placeholder="คำคม" required>
    <input id="author" placeholder="ผู้พูด" required>
    <button type="submit">เพิ่ม</button>
  </form>
  <p id="msg"></p>
  <hr>
  <button id="load">ดูคำคมทั้งหมด</button>
  <pre id="list"></pre>
  <script src="script.js"></script>
</body>
</html>
```

`public/script.js`:

```javascript
// script.js — POST คำคมใหม่ + GET รายการทั้งหมด
document.getElementById('quoteForm').addEventListener('submit', async (e) => {
  e.preventDefault(); // กัน form reload หน้า

  const text = document.getElementById('text').value;
  const author = document.getElementById('author').value;

  const response = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, author }),
  });

  if (response.ok) {
    document.getElementById('msg').textContent = 'เพิ่มแล้ว!';
    e.target.reset(); // clear form
  } else {
    const err = await response.json();
    document.getElementById('msg').textContent = 'ผิดพลาด: ' + err.error;
  }
});

document.getElementById('load').addEventListener('click', async () => {
  const response = await fetch('/api/quotes');
  const data = await response.json();
  document.getElementById('list').textContent = JSON.stringify(data, null, 2);
});
```

ทดสอบ: กรอกฟอร์ม → กดเพิ่ม → กด "ดูทั้งหมด" → เห็นคำคมใหม่ปรากฏ

---

## ③ Concept check

1. POST ส่งข้อมูลที่ไหน ต่างจาก GET ยังไง?
2. ทำไมต้องมี `app.use(express.json())` ทุกครั้งที่รับ POST?
3. `Content-Type: application/json` header สำคัญยังไง?
4. ทำไม validation สำคัญ แม้ผู้ใช้จะกรอกผ่านฟอร์มที่ดูปลอดภัย?

---

## 🏢 Office bridge

> ใน Next.js คุณเคยเจอ Server Action หรือ POST route ไหม? `export async function POST(req) { const body = await req.json(); ... }` — นั่นคือสิ่งเดียวกัน. ตอนนี้คุณรู้แล้วว่า `await req.json()` มาจากไหน และทำไมต้อง validate. คราวหน้าที่เจอ Server Action ที่ออฟฟิศ คุณจะเข้าใจ flow เต็มรูปแบบ.

---

## 📚 ทรัพยากร

- [Express `req.body`](https://expressjs.com/en/api.html#req.body)
- [express.json() middleware](https://expressjs.com/en/api.html#express.json)
- [Fetch POST example — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#creating_a_request)

---

## ✅ เสร็จสัปดาห์นี้?

- [ ] ติ๊ก checkbox ใน `PROGRESS.md` → สัปดาห์ 7
- [ ] Commit: `git add -A && git commit -m "feat(week7): POST form to API with validation"`
- [ ] ตอบ concept check 4 ข้อ
````

- [ ] **Step 2: สร้าง starter code files (reference)**

Create the 3 starter files under `/Users/prapon.t/ZCodeProject/docs/weeks/code/week-7/` with content matching the code blocks in week-7.md above (`server.js`, `public/index.html`, `public/script.js`)

- [ ] **Step 3: Commit**

Run: `git add -A && git commit -m "feat(week7): POST & data in/out — form + validation"`
Expected: commit สำเร็จ

---

## Task 8: สัปดาห์ 8 — Capstone

**Files:**
- Create: `/Users/prapon.t/ZCodeProject/docs/weeks/week-8.md`

- [ ] **Step 1: เขียน `docs/weeks/week-8.md`**

Create `/Users/prapon.t/ZCodeProject/docs/weeks/week-8.md`:

````markdown
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

> 🎉 ตอนนี้คุณเข้าใจทั้งฝั่ง client และฝั่ง server แล้ว — ทุกอย่างที่ Next.js ทำให้ คุณรู้แล้วว่า "มาแทนอะไร". คราวหน้าที่เปิด Next.js ที่ออฟฟิศ คุณจะมองเห็น fetch, async/await, Response.json, routing, error/loading states ที่ Next.js ห่อไว้ — ทั้งหมดคือสิ่งที่คุณเขียนเองมาแล้ว. **นี่คือจุดเปลี่ยนจาก copy-paste developer → นักพัฒนาที่เข้าใจจริง**.
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
````

- [ ] **Step 2: Commit**

Run: `git add -A && git commit -m "feat(week8): capstone + CORS/auth intro"`
Expected: commit สำเร็จ

---

## Task 9: ปิดท้าย — README link + spec doc commit

**Files:**
- Modify: `/Users/prapon.t/ZCodeProject/README.md` (เพิ่ม link เข้า week files)

- [ ] **Step 1: ตรวจสอบโครงสร้างไฟล์ครบ**

Run: `ls -R docs/weeks/ && ls PROGRESS.md README.md .gitignore`
Expected: เห็น `week-1.md` ถึง `week-8.md` + โฟลเดอร์ `code/week-1`, `code/week-6`, `code/week-7` + tracker/README/gitignore

- [ ] **Step 2: ตรวจสอบความสม่ำเสมอของชื่อ**

Run: `grep -l "week-" docs/weeks/*.md | wc -l`
Expected: `8` (มี 8 ไฟล์ week)

- [ ] **Step 3: Commit สุดท้าย (spec doc + plan doc เข้า repo)**

Run: `git add -A && git commit -m "docs: add design spec + implementation plan"`
Expected: commit สำเร็จ

- [ ] **Step 4: เช็ก git log สรุปผลงาน**

Run: `git log --oneline`
Expected: เห็น commit ตามลำดับ: bootstrap → week1 → ... → week8 → docs

---

## Self-Review

หลังเขียนแผนเสร็จ ผมตรวจสอบกับ spec:

**1. Spec coverage:**
- ✅ บริบทผู้เรียน (HTML/CSS + JS fundamentals, Next.js ที่ออฟฟิศ) — reflected ใน office bridge ทุกสัปดาห์
- ✅ Mental model 5 ไอเดีย → Task 1 (สัปดาห์ 1)
- ✅ Concept-anchored spiral → โครงสร้าง 8 สัปดาห์
- ✅ Tech stack: Express + vanilla JS + git → Tasks 1, 6, 7
- ✅ Tracker `PROGRESS.md` (B: overview + weekly) → Task 0
- ✅ สไตล์เนื้อหา (ไทย + technical terms, code comment อังกฤษ) → applied ทุก week file
- ✅ Office bridge ทุกสัปดาห์ → Tasks 1–8
- ✅ Bonus 🅱️ trigger → อยู่ใน week-5.md + PROGRESS.md
- ✅ Phase 2 (Next.js) preview → อยู่ใน spec doc เท่านั้น (ตามขอบเขต)
- ✅ Delivery: markdown files + interactive → โครงสร้างไฟล์ + concept check ต่อสัปดาห์

**2. Placeholder scan:**
- ✅ ไม่มี TBD/TODO — ทุก step มีเนื้อหาครบ
- ⚠️ Task 6 step 2 + Task 7 step 2 อ้าง "copy เนื้อหาจากด้านบน" — เพื่อหลีกเลี่ยงการ duplicate โค้ดยาวในแผน (เนื้อหาเต็มอยู่ใน week-N.md แล้ว). นี่เป็นข้อยกเว้นที่ตั้งใจ เพราะเนื้อหาเดียวกันปรากฏใน week file แล้ว — executor อ่าน week file แล้วสร้าง starter code ได้โดยตรง

**3. Type/consistency check:**
- ✅ Status code 200/201/400/404 ใช้สม่ำเสมอตลอดแผน
- ✅ `async/await` และ `.then()` ใช้ตามช่วงที่เหมาะ (week 1–3 = `.then`, week 4 เป็นต้นไป = `async/await`)
- ✅ ชื่อไฟล์/path สม่ำเสมอ (`docs/weeks/week-N.md`, `docs/weeks/code/week-N/`)
- ✅ Concept check = 4 ข้อเสมอทุกสัปดาห์

ไม่พบปัญหาที่ต้องแก้ — แผนพร้อม

---

## Execution Handoff

แผนเสร็จและเซฟที่ `docs/superpowers/plans/2026-06-30-learning-api-curriculum.md`. สองทางเลือก:

1. **Subagent-Driven (แนะนำ)** — ผมส่ง subagent ใหม่ทีละ task, review ระหว่าง task, เร็ว
2. **Inline Execution** — ทำใน session นี้ทีละ task พร้อม checkpoint

เลือกแบบไหน?

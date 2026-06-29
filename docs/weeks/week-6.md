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

> ใน Next.js API route คุณเขียน handler ในไฟล์ `app/api/quotes/route.ts` แบบนี้: `export async function GET() { return Response.json(quotes); }`. สังเกตว่ามันคือสิ่งเดียวกัน — `GET` handler + `Response.json`. ต่างแค่ Next.js จัด routing ให้ตามโครงไฟล์ แทนที่จะเขียน `app.get(...)` เอง. ตอนนี้คุณรู้แล้วว่ามันห่ออะไรซ่อนไว้

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

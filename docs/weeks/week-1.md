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
- [ ] ตอบ concept check 4 ข้อ (เขียนคำตอบใน notebook หรือที่ปรึกส่วนตัว)

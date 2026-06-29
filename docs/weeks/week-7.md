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

> ใน Next.js คุณเคยเจอ Server Action หรือ POST route ไหม? `export async function POST(req) { const body = await req.json(); ... }` — นั่นคือสิ่งเดียวกัน. ตอนนี้คุณรู้แล้วว่า `await req.json()` มาจากไหน และทำไมต้อง validate. คราวหน้าที่เจอ Server Action ที่ออฟฟิศ คุณจะเข้าใจ flow เต็มรูปแบบ

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

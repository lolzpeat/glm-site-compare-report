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

> ใน Next.js API route (`app/api/.../route.ts`) คุณก็ส่ง `Response.json({...}, { status: 200 })` กลับเหมือนกันเป๊ะ — ตัว `Response` นั้นคือ Web API เดียวกับ `fetch` ฝั่ง client. ฝั่งรับก็ทำ `const data = await response.json()` เหมือนกัน. สัปดาห์นี้ทำให้คุณเห็นว่าสองฝั่งใช้ภาษาเดียวกัน

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

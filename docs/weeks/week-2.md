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

> ใน Next.js เวลาคุณเรียก API (เช่น `fetch('/api/users')` ใน client component) มันคือ GET request เหมือนกันเป๊ะ — ต่างแค่ path เป็น route ของ Next.js เอง. สิ่งที่คุณเรียนสัปดาห์นี้คือสิ่งที่ Next.js ทำใต้ฝาโผล่ออกมาให้เห็น

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

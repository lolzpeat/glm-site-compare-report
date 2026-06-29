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

> ใน Next.js คุณเคยเจอ `loading.tsx` และ `error.tsx` ไหม? นั่นคือ Next.js ทำสิ่งเดียวกันที่คุณเขียนสัปดาห์นี้ — แค่ห่อเป็นไฟล์ convention ให้อัตโนมัติ. พอเข้าใจสัปดาห์นี้ คุณจะรู้ว่า Next.js ทำอะไรให้ข้างหลัง และจะปรับแต่งมันได้

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

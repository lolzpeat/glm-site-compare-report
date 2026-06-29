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

> นี่คือสิ่งที่คุณเขียนใน Next.js Server Component ทุกวัน — `async function Page() { const data = await fetch(...); }`. ตอนนี้คุณรู้แล้วว่า `async/await` มาจากไหน และทำไมต้องมี `async` นำหน้า. คราวหน้าที่เจอ Server Component ที่ออฟฟิศ คุณจะอ่านออกและแก้ได้ ไม่ใช่ copy-paste อีกต่อไป

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

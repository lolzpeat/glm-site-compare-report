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

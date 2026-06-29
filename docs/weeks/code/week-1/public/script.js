// script.js — เรียก API แล้วแสดงผลในหน้าเว็บ
fetch('/api/hello')                    // send GET request
  .then(response => response.json())  // parse JSON body
  .then(data => {
    document.getElementById('output').textContent = data.message; // render
  });

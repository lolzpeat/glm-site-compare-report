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

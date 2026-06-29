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

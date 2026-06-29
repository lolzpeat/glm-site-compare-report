// server.js — 10 บรรทัด: Express server ที่ส่ง JSON กลับ
const express = require('express');
const app = express();

// GET endpoint ที่ path "/api/hello"
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from API!' }); // send JSON response
});

// Serve static files from "public" folder
app.use(express.static('public'));

// Start server on port 3000
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});

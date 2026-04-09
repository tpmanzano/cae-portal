const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dre-lookup', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dre-lookup.html'));
});

app.listen(PORT, () => {
  console.log(`CAE Portal running on port ${PORT}`);
});

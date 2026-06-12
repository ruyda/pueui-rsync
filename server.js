const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8889;
const DATA_DIR = path.join(__dirname, 'data');
const DESTINATIONS_FILE = path.join(DATA_DIR, 'destinations.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DESTINATIONS_FILE)) fs.writeFileSync(DESTINATIONS_FILE, '[]\n');

function readDestinations() {
  try {
    return JSON.parse(fs.readFileSync(DESTINATIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function shellEscape(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

app.get('/api/status', (req, res) => {
  execFile('pueue', ['status', '--json'], (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    try {
      res.json(JSON.parse(stdout));
    } catch {
      res.status(500).json({ error: 'Failed to parse pueue output' });
    }
  });
});

app.post('/api/queue', (req, res) => {
  const { source, dest, bwlimit, trailingSlash } = req.body;
  if (!source || !dest) return res.status(400).json({ error: 'source and dest required' });

  let sourcePath = source.trim();
  if (trailingSlash) {
    if (!sourcePath.endsWith('/')) sourcePath += '/';
  } else {
    sourcePath = sourcePath.replace(/\/$/, '');
  }

  const bwlimitVal = Math.max(1, parseInt(bwlimit) || 20000);

  const args = [
    'add', '--',
    'rsync', '-ah', '--info=progress2',
    `--bwlimit=${bwlimitVal}`,
    shellEscape(sourcePath),
    shellEscape(dest.trim()),
  ];

  execFile('pueue', args, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ success: true, output: stdout.trim() });
  });
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });

  execFile('pueue', ['remove', String(id)], (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ success: true });
  });
});

app.get('/api/destinations', (req, res) => {
  res.json(readDestinations());
});

app.post('/api/destinations', (req, res) => {
  const { name, path: destPath } = req.body;
  if (!name || !destPath) return res.status(400).json({ error: 'name and path required' });

  const data = readDestinations();
  if (data.find(d => d.name === name)) {
    return res.status(409).json({ error: `"${name}" already exists` });
  }
  data.push({ name, path: destPath });
  fs.writeFileSync(DESTINATIONS_FILE, JSON.stringify(data, null, 2) + '\n');
  res.json({ success: true });
});

app.delete('/api/destinations/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const data = readDestinations().filter(d => d.name !== name);
  fs.writeFileSync(DESTINATIONS_FILE, JSON.stringify(data, null, 2) + '\n');
  res.json({ success: true });
});

// Serve the app to router-connected devices.
app.listen(PORT, '0.0.0.0', () => console.log(`pueui listening on http://localhost:${PORT}`));

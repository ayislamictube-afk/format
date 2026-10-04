const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.UPLOAD_PASSWORD || '';          // ঐচ্ছিক: আপলোড পাসওয়ার্ড
const MAX_MB = Number(process.env.MAX_MB || 100);
const BASE = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const UPLOAD_DIR = process.env.UPLOAD_DIR ||
  (fs.existsSync('/var/data') ? '/var/data/uploads' : path.join(__dirname, 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

// যেকোনো ওয়েবসাইট/অ্যাপ/বট থেকে এই লিংক ব্যবহার করা যাবে (CORS + হটলিংক চালু)
app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,x-password',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const publicUrl = (req) => BASE || `${req.protocol}://${req.get('host')}`;

function cleanName(n) {
  n = path.basename(String(n || 'file')).replace(/[^\w.\-() \u0980-\u09FF]/g, '_').replace(/\s+/g, '_');
  if (n.startsWith('.')) n = 'file' + n;
  return n.slice(0, 150) || 'file';
}

// নতুন ফাইলের জন্য জায়গা বানায়: /f/<id>/<filename>
function store(rawName) {
  const name = cleanName(rawName);
  const id = crypto.randomBytes(5).toString('hex');
  const dir = path.join(UPLOAD_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, name, dir, filePath: path.join(dir, name), urlPath: `/f/${id}/${encodeURIComponent(name)}` };
}

function needAuth(req, res, next) {
  if (!PASSWORD) return next();
  const given = req.get('x-password') || req.query.password || '';
  if (given === PASSWORD) return next();
  res.status(401).json({ ok: false, error: 'ভুল বা অনুপস্থিত পাসওয়ার্ড' });
}

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: MAX_MB * 1024 * 1024 } });

// ---------- আপলোড (ফর্ম / API) ----------
app.post('/upload', needAuth, upload.any(), (req, res) => {
  const files = (req.files || []).map((f) => {
    const s = store(Buffer.from(f.originalname, 'latin1').toString('utf8'));
    fs.copyFileSync(f.path, s.filePath);
    fs.unlinkSync(f.path);
    return { name: s.name, size: f.size, url: publicUrl(req) + s.urlPath };
  });
  res.json({ ok: true, files });
});

// ---------- র' আপলোড: curl -T file.png https://site/upload/file.png ----------
app.put('/upload/:name', needAuth, (req, res) => {
  const s = store(req.params.name);
  const ws = fs.createWriteStream(s.filePath);
  let size = 0, aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_MB * 1024 * 1024 && !aborted) {
      aborted = true; req.unpipe(ws); ws.destroy();
      fs.rmSync(s.dir, { recursive: true, force: true });
      res.status(413).json({ ok: false, error: `ফাইল ${MAX_MB}MB এর বেশি` });
    }
  });
  req.pipe(ws);
  ws.on('finish', () => !aborted && res.json({ ok: true, files: [{ name: s.name, size, url: publicUrl(req) + s.urlPath }] }));
});

// ---------- ফাইল দেখা/ডাউনলোড ----------
app.get('/f/:id/:name', (req, res) => {
  if (!/^[a-f0-9]{10}$/.test(req.params.id)) return res.sendStatus(404);
  res.sendFile(path.basename(req.params.name), { root: path.join(UPLOAD_DIR, req.params.id) },
    (err) => { if (err && !res.headersSent) res.sendStatus(404); });
});

app.get('/health', (req, res) => res.send('ok'));
app.get('/config', (req, res) => res.json({ needPassword: !!PASSWORD, maxMB: MAX_MB, base: publicUrl(req) }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Telegram বট (BOT_TOKEN দিলে চালু হবে) ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
if (BOT_TOKEN) {
  const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
  const SECRET = crypto.createHash('sha256').update(BOT_TOKEN).digest('hex').slice(0, 32);
  const allowed = (process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const tg = (method, body) => fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());

  app.post('/telegram', async (req, res) => {
    if (req.get('x-telegram-bot-api-secret-token') !== SECRET) return res.sendStatus(403);
    res.sendStatus(200);
    try {
      const m = req.body.message;
      if (!m) return;
      const chat = m.chat.id;
      if (allowed.length && !allowed.includes(String(chat))) return;
      const f = m.document || m.video || m.audio || m.voice || m.animation || m.video_note || m.sticker ||
        (m.photo && m.photo[m.photo.length - 1]);
      if (!f) {
        return tg('sendMessage', { chat_id: chat, text: 'যেকোনো ফাইল/ছবি/ভিডিও পাঠান, আমি লিংক দিয়ে দেব (সর্বোচ্চ 20MB)।' });
      }
      const info = await tg('getFile', { file_id: f.file_id });
      if (!info.ok) return tg('sendMessage', { chat_id: chat, text: 'ফাইল আনা যায়নি (20MB এর বেশি হতে পারে)।' });
      const buf = Buffer.from(await (await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`)).arrayBuffer());
      const s = store(f.file_name || path.basename(info.result.file_path));
      fs.writeFileSync(s.filePath, buf);
      await tg('sendMessage', { chat_id: chat, text: `✅ আপলোড হয়েছে:\n${BASE}${s.urlPath}` });
    } catch (e) { console.error('telegram error', e); }
  });

  if (BASE) {
    tg('setWebhook', { url: `${BASE}/telegram`, secret_token: SECRET })
      .then((r) => console.log('Telegram webhook:', r.ok ? 'সেট হয়েছে' : JSON.stringify(r)));
  } else console.log('PUBLIC_URL নেই, Telegram webhook সেট হয়নি');
}

// ---------- নিজের বট/সফটওয়্যার: bots/ ফোল্ডারের প্রতিটি .js অটো লোড হবে ----------
const botsDir = path.join(__dirname, 'bots');
if (fs.existsSync(botsDir)) {
  for (const file of fs.readdirSync(botsDir)) {
    if (!file.endsWith('.js') || file.startsWith('_')) continue;
    try {
      require(path.join(botsDir, file))({ app, express, store, UPLOAD_DIR, BASE, publicUrl });
      console.log('লোড হয়েছে: bots/' + file);
    } catch (e) { console.error('bots/' + file + ' এ সমস্যা:', e); }
  }
}

app.use((err, req, res, next) => res.status(400).json({ ok: false, error: err.message }));
if (BASE) setInterval(() => fetch(BASE + '/health').catch(() => {}), 10 * 60 * 1000);

app.listen(PORT, () => console.log(`Server চলছে port ${PORT}, ফাইল: ${UPLOAD_DIR}`));

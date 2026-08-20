const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const KEYS_FILE = path.join(__dirname, 'keys.json');
const BANS_FILE = path.join(__dirname, 'banned.json');
const MAX_USES_PER_DEVICE = 5;

// غيّر هذا السر لأي شي تختاره انت، وحطه بإعدادات Render كمتغير بيئة اسمه ADMIN_SECRET
// لا تشارك هذا السر مع أحد - هو يفتح لوحة التحكم الإدارية
const ADMIN_SECRET = process.env.ADMIN_SECRET || '1703c74c31677f9bd7e67db57a92153d';

function loadKeys() {
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}
function saveKeys(keys) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}
function loadBans() {
  if (!fs.existsSync(BANS_FILE)) return [];
  return JSON.parse(fs.readFileSync(BANS_FILE, 'utf8'));
}
function saveBans(bans) {
  fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
}

// حماية بسيطة لكل نقاط الإدارة - يطلب هيدر x-admin-secret مطابق
function requireAdmin(req, res, next) {
  const secret = req.header('x-admin-secret');
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// ============ نقطة التحقق من المفتاح (يستخدمها البرنامج C++) ============
app.post('/check-key', (req, res) => {
  const { key, hwid } = req.body;

  if (!key || !hwid) {
    return res.status(400).json({ success: false, message: 'Missing key or hwid' });
  }

  // تحقق من قائمة الحظر أول شي - أي جهاز محظور ما يشتغل معه ولا مفتاح
  const bans = loadBans();
  if (bans.includes(hwid)) {
    return res.json({ success: false, message: 'This device has been banned' });
  }

  const keys = loadKeys();
  const entry = keys.find(k => k.key === key);

  if (!entry) {
    return res.json({ success: false, message: 'Invalid key' });
  }

  if (entry.used) {
    if (entry.hwid !== hwid) {
      return res.json({ success: false, message: 'Key already used on another device' });
    }

    entry.uses = (entry.uses || 1);
    if (entry.uses >= MAX_USES_PER_DEVICE) {
      return res.json({ success: false, message: 'This key has reached its usage limit on this device' });
    }

    entry.uses += 1;
    entry.lastUsedAt = new Date().toISOString();
    saveKeys(keys);

    return res.json({
      success: true,
      message: `Welcome back (${entry.uses}/${MAX_USES_PER_DEVICE} uses)`
    });
  }

  // أول استخدام
  entry.used = true;
  entry.hwid = hwid;
  entry.uses = 1;
  entry.activatedAt = new Date().toISOString();
  entry.lastUsedAt = entry.activatedAt;
  saveKeys(keys);

  return res.json({
    success: true,
    message: `Key activated successfully (1/${MAX_USES_PER_DEVICE} uses)`
  });
});

// ============ نقاط الإدارة (محمية بكلمة السر) ============

// عرض كل المفاتيح مع حالتها (الاسم/الليبل، هل استُخدمت، كم مرة، جهاز مين)
app.get('/admin/keys', requireAdmin, (req, res) => {
  const keys = loadKeys();
  res.json({ success: true, keys });
});

// تعيين اسم/رقم مخصص لمفتاح معين (مثلاً "Person 1")
app.post('/admin/label', requireAdmin, (req, res) => {
  const { key, label } = req.body;
  if (!key || label === undefined) {
    return res.status(400).json({ success: false, message: 'Missing key or label' });
  }

  const keys = loadKeys();
  const entry = keys.find(k => k.key === key);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Key not found' });
  }

  entry.label = label;
  saveKeys(keys);
  res.json({ success: true, message: 'Label updated', key: entry });
});

// توليد مفتاح جديد عشوائي وإضافته تلقائياً لقائمة المفاتيح
app.post('/admin/generate-key', requireAdmin, (req, res) => {
  const { label } = req.body;
  const crypto = require('crypto');

  function genKey() {
    const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return 'NIRVANA-' + part() + '-' + part() + '-' + part();
  }

  const keys = loadKeys();
  let newKey;
  do {
    newKey = genKey();
  } while (keys.some(k => k.key === newKey)); // تأكد ما يكرر مفتاح موجود

  const entry = { key: newKey, label: label || '', used: false, hwid: null, uses: 0 };
  keys.push(entry);
  saveKeys(keys);

  res.json({ success: true, message: 'Key generated', key: entry });
});

// إضافة مفتاح مخصص يدوياً (يكتبه الأدمن بنفسه)
app.post('/admin/add-key', requireAdmin, (req, res) => {
  const { key, label } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: 'Missing key' });
  }

  const keys = loadKeys();
  if (keys.some(k => k.key === key)) {
    return res.status(409).json({ success: false, message: 'Key already exists' });
  }

  const entry = { key, label: label || '', used: false, hwid: null, uses: 0 };
  keys.push(entry);
  saveKeys(keys);

  res.json({ success: true, message: 'Key added', key: entry });
});

// حذف مفتاح نهائياً
app.post('/admin/delete-key', requireAdmin, (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: 'Missing key' });
  }

  let keys = loadKeys();
  const before = keys.length;
  keys = keys.filter(k => k.key !== key);
  saveKeys(keys);

  res.json({ success: true, message: before !== keys.length ? 'Key deleted' : 'Key not found' });
});


app.post('/admin/ban', requireAdmin, (req, res) => {
  const { hwid } = req.body;
  if (!hwid) {
    return res.status(400).json({ success: false, message: 'Missing hwid' });
  }

  const bans = loadBans();
  if (!bans.includes(hwid)) {
    bans.push(hwid);
    saveBans(bans);
  }
  res.json({ success: true, message: `Device ${hwid} banned`, bans });
});

// رفع الحظر عن جهاز
app.post('/admin/unban', requireAdmin, (req, res) => {
  const { hwid } = req.body;
  if (!hwid) {
    return res.status(400).json({ success: false, message: 'Missing hwid' });
  }

  let bans = loadBans();
  bans = bans.filter(b => b !== hwid);
  saveBans(bans);
  res.json({ success: true, message: `Device ${hwid} unbanned`, bans });
});

// عرض قائمة الأجهزة المحظورة
app.get('/admin/bans', requireAdmin, (req, res) => {
  res.json({ success: true, bans: loadBans() });
});

// ============ صفحة تأكيد إن السيرفر شغال ============
app.get('/', (req, res) => {
  res.send('NIRVANA TWEAK key server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

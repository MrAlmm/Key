const express = require('express');
const path = require('path');
const { Redis } = require('@upstash/redis');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MAX_USES_PER_DEVICE = 5;

// بيانات الاتصال بقاعدة البيانات الدائمة (Upstash) - تجيبها من لوحة تحكم Upstash
// وتحطها بإعدادات Render كمتغيرات بيئة (Environment Variables)
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// غيّر هذا السر لأي شي تختاره انت، وحطه بإعدادات Render كمتغير بيئة اسمه ADMIN_SECRET
const ADMIN_SECRET = process.env.ADMIN_SECRET || '1703c74c31677f9bd7e67db57a92153d';

async function loadKeys() {
  const data = await redis.get('keys');
  return data || [];
}
async function saveKeys(keys) {
  await redis.set('keys', keys);
}
async function loadBans() {
  const data = await redis.get('bans');
  return data || [];
}
async function saveBans(bans) {
  await redis.set('bans', bans);
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
app.post('/check-key', async (req, res) => {
  try {
    const { key, hwid } = req.body;

    if (!key || !hwid) {
      return res.status(400).json({ success: false, message: 'Missing key or hwid' });
    }

    const bans = await loadBans();
    if (bans.includes(hwid)) {
      return res.json({ success: false, message: 'This device has been banned' });
    }

    const keys = await loadKeys();
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
      await saveKeys(keys);

      return res.json({
        success: true,
        message: `Welcome back (${entry.uses}/${MAX_USES_PER_DEVICE} uses)`
      });
    }

    entry.used = true;
    entry.hwid = hwid;
    entry.uses = 1;
    entry.activatedAt = new Date().toISOString();
    entry.lastUsedAt = entry.activatedAt;
    await saveKeys(keys);

    return res.json({
      success: true,
      message: `Key activated successfully (1/${MAX_USES_PER_DEVICE} uses)`
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ نقاط الإدارة (محمية بكلمة السر) ============

app.get('/admin/keys', requireAdmin, async (req, res) => {
  const keys = await loadKeys();
  res.json({ success: true, keys });
});

app.post('/admin/label', requireAdmin, async (req, res) => {
  const { key, label } = req.body;
  if (!key || label === undefined) {
    return res.status(400).json({ success: false, message: 'Missing key or label' });
  }

  const keys = await loadKeys();
  const entry = keys.find(k => k.key === key);
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Key not found' });
  }

  entry.label = label;
  await saveKeys(keys);
  res.json({ success: true, message: 'Label updated', key: entry });
});

app.post('/admin/generate-key', requireAdmin, async (req, res) => {
  const { label } = req.body;
  const crypto = require('crypto');

  function genKey() {
    const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    return 'NIRVANA-' + part() + '-' + part() + '-' + part();
  }

  const keys = await loadKeys();
  let newKey;
  do {
    newKey = genKey();
  } while (keys.some(k => k.key === newKey));

  const entry = { key: newKey, label: label || '', used: false, hwid: null, uses: 0 };
  keys.push(entry);
  await saveKeys(keys);

  res.json({ success: true, message: 'Key generated', key: entry });
});

app.post('/admin/add-key', requireAdmin, async (req, res) => {
  const { key, label } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: 'Missing key' });
  }

  const keys = await loadKeys();
  if (keys.some(k => k.key === key)) {
    return res.status(409).json({ success: false, message: 'Key already exists' });
  }

  const entry = { key, label: label || '', used: false, hwid: null, uses: 0 };
  keys.push(entry);
  await saveKeys(keys);

  res.json({ success: true, message: 'Key added', key: entry });
});

app.post('/admin/delete-key', requireAdmin, async (req, res) => {
  const { key } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, message: 'Missing key' });
  }

  let keys = await loadKeys();
  const before = keys.length;
  keys = keys.filter(k => k.key !== key);
  await saveKeys(keys);

  res.json({ success: true, message: before !== keys.length ? 'Key deleted' : 'Key not found' });
});

// إحصائية إجمالي عدد مرات تشغيل البرنامج (كل المفاتيح مع بعض)
app.get('/admin/stats', requireAdmin, async (req, res) => {
  const keys = await loadKeys();

  const totalRuns = keys.reduce((sum, k) => sum + (k.uses || 0), 0);
  const activatedKeys = keys.filter(k => k.used).length;
  const totalKeys = keys.length;

  res.json({
    success: true,
    totalRuns,        // إجمالي عدد مرات فتح البرنامج (كل المفاتيح مجتمعة)
    activatedKeys,     // كم مفتاح تم تفعيله
    totalKeys          // إجمالي عدد المفاتيح الموجودة
  });
});

app.post('/admin/ban', requireAdmin, async (req, res) => {
  const { hwid } = req.body;
  if (!hwid) {
    return res.status(400).json({ success: false, message: 'Missing hwid' });
  }

  const bans = await loadBans();
  if (!bans.includes(hwid)) {
    bans.push(hwid);
    await saveBans(bans);
  }
  res.json({ success: true, message: `Device ${hwid} banned`, bans });
});

app.post('/admin/unban', requireAdmin, async (req, res) => {
  const { hwid } = req.body;
  if (!hwid) {
    return res.status(400).json({ success: false, message: 'Missing hwid' });
  }

  let bans = await loadBans();
  bans = bans.filter(b => b !== hwid);
  await saveBans(bans);
  res.json({ success: true, message: `Device ${hwid} unbanned`, bans });
});

app.get('/admin/bans', requireAdmin, async (req, res) => {
  res.json({ success: true, bans: await loadBans() });
});

// ============ صفحة تأكيد إن السيرفر شغال ============
app.get('/', (req, res) => {
  res.send('NIRVANA TWEAK key server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

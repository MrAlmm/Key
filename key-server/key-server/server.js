const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const KEYS_FILE = path.join(__dirname, 'keys.json');

function loadKeys() {
  return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
}

function saveKeys(keys) {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
}

// نقطة التحقق من المفتاح - يستدعيها البرنامج عند البدء
app.post('/check-key', (req, res) => {
  const { key, hwid } = req.body;

  if (!key || !hwid) {
    return res.status(400).json({ success: false, message: 'Missing key or hwid' });
  }

  const keys = loadKeys();
  const entry = keys.find(k => k.key === key);

  if (!entry) {
    return res.json({ success: false, message: 'Invalid key' });
  }

  if (entry.used) {
    // لو نفس الجهاز يلي فعّل المفتاح، نسمحله يدخل مرة ثانية بدون ما نعتبره نسخة جديدة
    if (entry.hwid === hwid) {
      return res.json({ success: true, message: 'Welcome back' });
    }
    return res.json({ success: false, message: 'Key already used on another device' });
  }

  // أول استخدام - نفعّل المفتاح ونربطه بهذا الجهاز، وينحذف من قائمة المتاح
  entry.used = true;
  entry.hwid = hwid;
  entry.activatedAt = new Date().toISOString();
  saveKeys(keys);

  return res.json({ success: true, message: 'Key activated successfully' });
});

// نقطة بسيطة للتأكد إن السيرفر شغال
app.get('/', (req, res) => {
  res.send('NIRVANA TWEAK key server is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

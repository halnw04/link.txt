// เก็บรายชื่อบัญชีลงไฟล์ JSON ส่วนรหัสผ่านเข้ารหัสด้วย safeStorage
// (บน Windows = DPAPI ผูกกับผู้ใช้ Windows คนนั้น ก๊อปไฟล์ไปเครื่องอื่นจะถอดไม่ได้)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const file = () => path.join(app.getPath('userData'), 'accounts.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return [];
  }
}

function persist(list) {
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file());
}

let accounts = null;
const all = () => (accounts ??= load());
const get = (id) => all().find((a) => a.id === id);

// ส่งให้หน้า UI: ไม่มีรหัสผ่านติดไปด้วย
const publicView = (a) => ({
  id: a.id,
  name: a.name,
  gameUrl: a.gameUrl,
  username: a.username,
  hasPassword: Boolean(a.passwordEnc),
  userSelector: a.userSelector || '',
  passSelector: a.passSelector || '',
});

function save(input) {
  const list = all();
  let acc = input.id && get(input.id);
  if (!acc) {
    acc = { id: crypto.randomUUID() };
    list.push(acc);
  }
  acc.name = String(input.name || 'บัญชีใหม่').slice(0, 40);
  acc.gameUrl = new URL(input.gameUrl).toString(); // โยน error ถ้า URL ไม่ถูก
  acc.username = String(input.username || '');
  acc.userSelector = String(input.userSelector || '');
  acc.passSelector = String(input.passSelector || '');
  if (input.password) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('เครื่องนี้เข้ารหัสรหัสผ่านไม่ได้');
    acc.passwordEnc = safeStorage.encryptString(input.password).toString('base64');
  }
  persist(list);
  return acc;
}

function remove(id) {
  accounts = all().filter((a) => a.id !== id);
  persist(accounts);
}

function password(acc) {
  if (!acc.passwordEnc) return '';
  return safeStorage.decryptString(Buffer.from(acc.passwordEnc, 'base64'));
}

module.exports = { all, get, save, remove, password, publicView };

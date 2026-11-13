// รันในหน้าเกม (isolated world: สคริปต์ของเว็บมองไม่เห็นโค้ดและรหัสในนี้)
// 1) เจอช่องรหัสผ่านว่าง -> กรอกชื่อ/รหัสให้ แต่ "ไม่กดเข้าเกม" ให้ผู้เล่นกดเอง
const { ipcRenderer } = require('electron');

let creds; // undefined = ยังไม่ได้ขอ, null = frame นี้ไม่ได้รับอนุญาต
const filled = new WeakSet();

const visible = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled;
};

function fill(el, value) {
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  filled.add(el);
}

function findFields(c) {
  const pass = c.passSelector
    ? document.querySelector(c.passSelector)
    : [...document.querySelectorAll('input[type=password]')].find(visible);
  if (!pass) return {};
  if (c.userSelector) return { pass, user: document.querySelector(c.userSelector) };
  // ช่องชื่อ = ช่องข้อความที่มองเห็นตัวสุดท้ายก่อนช่องรหัส
  const scope = pass.form || document;
  const inputs = [...scope.querySelectorAll('input:not([type]), input[type=text], input[type=email]')].filter(visible);
  const before = inputs.filter((i) => i.compareDocumentPosition(pass) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { pass, user: before.at(-1) };
}

async function tryFill() {
  if (creds === undefined) creds = await ipcRenderer.invoke('cred:get');
  if (!creds || !creds.password) return;
  const { pass, user } = findFields(creds);
  if (!pass || filled.has(pass) || pass.value) return; // ผู้เล่นพิมพ์เองอยู่ -> ไม่ยุ่ง
  if (user && !user.value && creds.username) fill(user, creds.username);
  fill(pass, creds.password);
}

let pending = false;
const schedule = () => {
  if (pending) return;
  pending = true;
  setTimeout(() => { pending = false; tryFill().catch(() => {}); }, 300);
};

window.addEventListener('DOMContentLoaded', () => {
  schedule();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
});

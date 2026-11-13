const $ = (s) => document.querySelector(s);
const STATUS = {
  stopped: 'พักอยู่ (ไม่กิน RAM)',
  loading: 'กำลังโหลด',
  running: 'กำลังเล่น',
  soft: 'พักเบา (ยังออนไลน์)',
  stuck: 'โหลดค้าง',
  frozen: 'ภาพค้าง',
  crashed: 'หน้าเกมพัง',
};
let state = { accounts: [], activeId: null };
const selected = new Set();

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
const btn = (text, onClick, cls = 'small') =>
  el('button', { textContent: text, className: cls, onclick: (ev) => { ev.stopPropagation(); onClick(); } });

function card(a) {
  const li = el('li', { className: a.id === state.activeId ? 'active' : '', onclick: () => api.show(a.id) });
  const check = el('input', { type: 'checkbox', checked: selected.has(a.id), onclick: (e) => e.stopPropagation() });
  check.onchange = () => { check.checked ? selected.add(a.id) : selected.delete(a.id); renderHint(); };

  li.append(el('div', { className: 'top' },
    check,
    el('span', { className: `dot ${a.state}` }),
    el('span', { className: 'name', textContent: a.name, title: a.username }),
    btn('แก้ไข', () => openForm(a)),
  ));

  const status = el('div', { className: 'status' }, el('span', { textContent: STATUS[a.state] || a.state }));
  if (a.state === 'loading' || a.state === 'stuck') {
    const fill = el('i');
    fill.style.width = `${a.pct}%`;
    status.append(el('div', { className: 'bar' }, fill), el('span', { textContent: `${a.pct}%` }));
  }
  li.append(status);

  // ปุ่มกู้คืนจะโผล่เฉพาะตอนมีปัญหา
  if (['stuck', 'frozen', 'crashed'].includes(a.state)) {
    li.append(el('div', { className: 'row actions' },
      btn('ลองอีกครั้ง', () => api.reload(a.id, false)),
      btn('รีเฟรชเกม', () => api.reload(a.id, true)),
    ));
  }
  return li;
}

function render() {
  const list = $('#list');
  list.replaceChildren(...state.accounts.map(card));
  for (const id of [...selected]) if (!state.accounts.some((a) => a.id === id)) selected.delete(id);
  $('#selAll').checked = state.accounts.length > 0 && selected.size === state.accounts.length;
  $('#empty').textContent = state.accounts.length ? 'เลือกบัญชีทางซ้ายเพื่อเปิดเกม' : 'กด "+ เพิ่ม" เพื่อเพิ่มบัญชีแรก';
  renderHint();
}

function renderHint() {
  $('#bulkHint').textContent = selected.size
    ? `เลือกไว้ ${selected.size} บัญชี`
    : 'ไม่ได้เลือก = ทำกับทุกบัญชี ยกเว้นตัวที่เปิดดูอยู่';
}

// ถ้าไม่ได้ติ๊กเลือก: ทำกับทุกตัวยกเว้นตัวที่ดูอยู่
const targets = (keepActive = true) =>
  selected.size ? [...selected] : state.accounts.map((a) => a.id).filter((id) => !keepActive || id !== state.activeId);

$('#pauseFull').onclick = () => api.pause(targets(), 'full');
$('#pauseSoft').onclick = () => api.pause(targets(), 'soft');
$('#restore').onclick = () => api.restoreMany(targets(false).filter((id) => {
  const a = state.accounts.find((x) => x.id === id);
  return a && (a.state === 'stopped' || a.state === 'soft');
}));
$('#selAll').onchange = (e) => {
  selected.clear();
  if (e.target.checked) state.accounts.forEach((a) => selected.add(a.id));
  render();
};

// ---------- ฟอร์มเพิ่ม/แก้ไข ----------
const form = $('#form');
function openForm(a) {
  form.reset();
  $('#formErr').textContent = '';
  $('#dlgTitle').textContent = a ? 'แก้ไขบัญชี' : 'เพิ่มบัญชี';
  $('#del').hidden = !a;
  for (const k of ['id', 'name', 'gameUrl', 'username', 'userSelector', 'passSelector']) form.elements[k].value = a?.[k] ?? '';
  form.elements.password.placeholder = a?.hasPassword ? 'เว้นว่าง = ใช้รหัสเดิม' : '';
  if (!a && state.accounts[0]) form.elements.gameUrl.value = state.accounts[0].gameUrl;
  $('#dlg').showModal();
}
$('#add').onclick = () => openForm(null);
$('#del').onclick = async () => {
  const id = form.elements.id.value;
  if (id && confirm('ลบบัญชีนี้และรหัสที่จำไว้?')) { await api.remove(id); $('#dlg').close(); }
};
form.addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  try {
    await api.save(Object.fromEntries(new FormData(form)));
    $('#dlg').close();
  } catch (err) {
    $('#formErr').textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
});

api.onState((s) => { state = s; render(); });
api.state().then((s) => { state = s; render(); });

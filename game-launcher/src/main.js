const path = require('path');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const store = require('./store');

const SIDEBAR = 300;          // ความกว้างแถบซ้าย (px)
const STUCK_MS = 20_000;      // โหลดแล้วเปอร์เซ็นต์ไม่ขยับนานเท่านี้ = ค้าง

let win;
let activeId = null;
// สถานะของแต่ละบัญชีตอนโปรแกรมเปิดอยู่ (ไม่ได้เขียนลงไฟล์)
// state: stopped | loading | running | stuck | frozen | crashed | soft
const rt = new Map();

const runtime = (id) => {
  if (!rt.has(id)) rt.set(id, { view: null, state: 'stopped', pct: 0, started: 0, done: 0, lastMove: 0, loaded: false, lastSig: null, sameShots: 0 });
  return rt.get(id);
};

function snapshot() {
  return {
    activeId,
    accounts: store.all().map((a) => {
      const r = runtime(a.id);
      return { ...store.publicView(a), state: r.state, pct: r.pct };
    }),
  };
}

function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
}

function setState(id, state) {
  const r = runtime(id);
  if (r.state !== state) {
    r.state = state;
    push();
  }
}

// ---------- จัดวางหน้าต่างเกม ----------
function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  for (const [id, r] of rt) {
    if (!r.view) continue;
    const show = id === activeId;
    r.view.setVisible(show);
    if (show) r.view.setBounds({ x: SIDEBAR, y: 0, width: Math.max(0, width - SIDEBAR), height });
    // ตัวที่ไม่ได้ดูอยู่: ปิดเสียง และปล่อยให้ Chromium ลดความถี่ timer/วาดภาพ
    r.view.webContents.setAudioMuted(!show);
  }
}

// ---------- นับเปอร์เซ็นต์โหลดจากจำนวน request ----------
// Chromium ไม่มีค่า "โหลดไปกี่ %" ให้ตรงๆ เลยประมาณจาก request ที่เสร็จ / ที่เริ่ม
function hookSession(id) {
  const ses = session.fromPartition(`persist:acc-${id}`);
  if (ses.__hooked) return;
  ses.__hooked = true;
  const mine = (d) => {
    const r = rt.get(id);
    return r && r.view && d.webContentsId === r.view.webContents.id && d.resourceType !== 'webSocket';
  };
  const bump = (r) => {
    const pct = r.started ? Math.min(99, Math.round((r.done / r.started) * 100)) : 0;
    if (pct !== r.pct) {
      r.pct = pct;
      r.lastMove = Date.now();
      push();
    }
    maybeRunning(id);
  };
  ses.webRequest.onBeforeRequest((d, cb) => {
    if (mine(d)) {
      const r = rt.get(id);
      r.started++;
      r.lastMove = Date.now();
    }
    cb({});
  });
  const finish = (d) => {
    if (mine(d)) {
      const r = rt.get(id);
      r.done++;
      bump(r);
    }
  };
  ses.webRequest.onCompleted(finish);
  ses.webRequest.onErrorOccurred(finish);
}

function maybeRunning(id) {
  const r = rt.get(id);
  if (r && r.loaded && r.done >= r.started && ['loading', 'stuck'].includes(r.state)) {
    r.pct = 100;
    setState(id, 'running');
  }
}

// ---------- เปิด / พัก / รีเฟรช ----------
function start(id) {
  const acc = store.get(id);
  if (!acc) return;
  const r = runtime(id);
  if (r.view) return; // เปิดอยู่แล้ว
  hookSession(id);

  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:acc-${id}`,     // คุกกี้/ล็อกอินแยกต่อบัญชี
      preload: path.join(__dirname, 'preload-game.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegrationInSubFrames: true,   // เผื่อหน้าล็อกอินอยู่ใน iframe
      backgroundThrottling: true,
    },
  });
  r.view = view;
  Object.assign(r, { started: 0, done: 0, pct: 0, loaded: false, lastMove: Date.now() });
  const wc = view.webContents;

  wc.on('did-start-loading', () => {
    Object.assign(r, { loaded: false, lastMove: Date.now() });
    if (r.state !== 'loading') setState(id, 'loading');
  });
  wc.on('did-finish-load', () => {
    r.loaded = true;
    maybeRunning(id);
  });
  wc.on('did-fail-load', (_e, code, desc, _url, isMain) => {
    if (isMain && code !== -3) setState(id, 'stuck'); // -3 = ผู้ใช้ยกเลิกเอง
  });
  wc.on('unresponsive', () => setState(id, 'frozen'));
  wc.on('responsive', () => r.state === 'frozen' && setState(id, 'running'));
  wc.on('render-process-gone', () => setState(id, 'crashed'));
  // ลิงก์เปิดหน้าต่างใหม่ -> เปิดในหน้าเดิมแทน
  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url);
    return { action: 'deny' };
  });

  win.contentView.addChildView(view);
  setState(id, 'loading');
  wc.loadURL(acc.gameUrl);
  layout();
}

// mode 'full' = ปิดหน้าเกมทิ้ง คืน RAM เกือบทั้งหมด (ตัวละครหลุดออกจากเกม)
// mode 'soft' = ซ่อนไว้ ยังออนไลน์อยู่ ลดแค่ CPU/GPU
function pause(id, mode) {
  const r = rt.get(id);
  if (!r || !r.view) return;
  if (mode === 'soft') {
    if (activeId === id) activeId = null;
    setState(id, 'soft');
    layout();
    return;
  }
  win.contentView.removeChildView(r.view);
  r.view.webContents.close();
  r.view = null;
  r.pct = 0;
  if (activeId === id) activeId = null;
  setState(id, 'stopped');
  layout();
}

function show(id) {
  const r = runtime(id);
  activeId = id;
  if (!r.view) start(id);
  else if (r.state === 'soft') setState(id, r.loaded ? 'running' : 'loading');
  layout();
  push();
}

function reload(id, hard) {
  const r = rt.get(id);
  if (!r) return;
  if (!r.view || r.state === 'crashed') {
    // renderer ตายแล้ว reload ไม่ได้ สร้างใหม่เลย
    if (r.view) pause(id, 'full');
    if (activeId === null) activeId = id;
    start(id);
    return;
  }
  Object.assign(r, { started: 0, done: 0, pct: 0, loaded: false, lastMove: Date.now() });
  setState(id, 'loading');
  hard ? r.view.webContents.reloadIgnoringCache() : r.view.webContents.reload();
}

// ตรวจ "โหลดค้าง" ทุก 2 วินาที
setInterval(() => {
  for (const [id, r] of rt) {
    if (r.state === 'loading' && Date.now() - r.lastMove > STUCK_MS) setState(id, 'stuck');
  }
}, 2000);

// ตรวจ "ภาพนิ่ง" ของหน้าที่ดูอยู่: จับภาพย่อ 64x36 ทุก 5 วิ ถ้าเหมือนเดิมทุกพิกเซล 3 รอบติด (15 วิ)
// ถือว่าภาพค้าง (เช่นตายแล้วกลับเมืองแล้วจอไม่ขยับ) ตัวละครใน RO มีท่าหายใจ ปกติภาพจะขยับเสมอ
setInterval(async () => {
  const r = activeId && rt.get(activeId);
  if (!r || !r.view || !['running', 'frozen'].includes(r.state)) return;
  const id = activeId;
  try {
    const img = await r.view.webContents.capturePage();
    if (img.isEmpty()) return;
    const sig = img.resize({ width: 64, height: 36, quality: 'good' }).toBitmap().toString('base64');
    if (sig === r.lastSig) {
      if (++r.sameShots >= 3 && r.state === 'running') setState(id, 'frozen');
    } else {
      r.sameShots = 0;
      if (r.state === 'frozen') setState(id, 'running');
    }
    r.lastSig = sig;
  } catch { /* หน้าถูกปิดไประหว่างจับภาพ */ }
}, 5000);

// ---------- IPC ----------
const accountOf = (sender) => {
  for (const [id, r] of rt) if (r.view && r.view.webContents === sender) return id;
  return null;
};

// หน้าเกมขอรหัส: ให้เฉพาะ frame ที่อยู่โดเมนเดียวกับ URL เกมของบัญชีนั้นเท่านั้น
ipcMain.handle('cred:get', (e) => {
  const id = accountOf(e.sender);
  const acc = id && store.get(id);
  if (!acc || !e.senderFrame) return null;
  let frameOrigin;
  try { frameOrigin = new URL(e.senderFrame.url).origin; } catch { return null; }
  if (frameOrigin !== new URL(acc.gameUrl).origin) return null;
  return { username: acc.username, password: store.password(acc), userSelector: acc.userSelector, passSelector: acc.passSelector };
});

const isUi = (e) => win && e.sender === win.webContents;
const ui = (ch, fn) => ipcMain.handle(ch, (e, ...a) => (isUi(e) ? fn(...a) : null));

ui('ui:state', () => snapshot());
ui('acc:save', (input) => { const a = store.save(input); push(); return a.id; });
ui('acc:delete', (id) => { pause(id, 'full'); rt.delete(id); store.remove(id); push(); });
ui('acc:show', (id) => show(id));
ui('acc:pause', (ids, mode) => { for (const id of ids) pause(id, mode); });
ui('acc:reload', (id, hard) => reload(id, hard));
ui('acc:restoreMany', async (ids) => {
  // เปิดทีละตัว เว้น 1.5 วิ กัน CPU พุ่งตอนโหลดพร้อมกัน
  for (const id of ids) {
    const r = runtime(id);
    if (!r.view) start(id);
    else if (r.state === 'soft') setState(id, r.loaded ? 'running' : 'loading');
    await new Promise((res) => setTimeout(res, 1500));
  }
  layout();
});

// ---------- เริ่มโปรแกรม ----------
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    title: 'Game Launcher',
    backgroundColor: '#14161a',
    webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('resize', layout);
});

app.on('window-all-closed', () => app.quit());

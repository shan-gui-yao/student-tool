/*
 * 大学生辅助器 · 桌面外壳
 *
 * 职责：
 *   1. 开一个无菜单窗口，加载 index.html
 *   2. 拦住外部链接，交给系统浏览器
 *   3. 提供本地转写通道：把录音 WAV 交给 whisper-cli.exe，回传带时间轴的文字
 *
 * 注意：whisper.cpp 的 Windows 版不认含中文的路径（会直接崩溃），
 * 所以模型、exe、临时 WAV 全部放在应用自己的目录下——
 * 而应用目录本身必须是纯英文，否则 Electron 起不来。这一条在 README 里写了。
 */
const { app, BrowserWindow, Menu, shell, screen, nativeTheme, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// 启动日志：桌面版出问题时先看这个文件
const BOOT_LOG = path.join(process.env.TEMP || __dirname, 'campus-assistant-boot.log');
function log(msg) {
  try {
    fs.appendFileSync(BOOT_LOG, '[' + new Date().toISOString() + '] ' + msg + '\r\n');
  } catch (e) { /* 日志写不进去就算了 */ }
}
log('main.js loaded, electron=' + process.versions.electron + ' node=' + process.versions.node);
process.on('uncaughtException', (err) => {
  log('uncaught: ' + (err && err.stack ? err.stack : err));
});

/* ---------------- 本地转写 ---------------- */
const WHISPER_DIR = path.join(__dirname, 'whisper');
const WHISPER_EXE = path.join(WHISPER_DIR, 'whisper-cli.exe');
const WHISPER_MODEL = path.join(WHISPER_DIR, 'ggml-base.bin');
const TMP_DIR = path.join(WHISPER_DIR, 'tmp');
// 这句提示词同时改善两件事：输出简体、术语更准
const PROMPT = '以下是普通话的句子，请用简体中文转写。';

function whisperReady() {
  return fs.existsSync(WHISPER_EXE) && fs.existsSync(WHISPER_MODEL);
}

function parseSegments(text) {
  const out = [];
  const re = /^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;
  text.split(/\r?\n/).forEach((line) => {
    const m = line.trim().match(re);
    if (!m) return;
    const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    const body = m[9].trim();
    if (body) out.push({ start: start, end: end, text: body });
  });
  return out;
}

ipcMain.handle('whisper-status', () => ({
  ready: whisperReady(),
  model: fs.existsSync(WHISPER_MODEL) ? path.basename(WHISPER_MODEL) : null,
  dir: WHISPER_DIR
}));

ipcMain.handle('transcribe', async (event, arrayBuffer) => {
  if (!whisperReady()) {
    return { ok: false, error: '缺少本地转写组件（whisper 目录不完整）' };
  }
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const wavPath = path.join(TMP_DIR, 'rec-' + stamp + '.wav');
  try {
    fs.writeFileSync(wavPath, Buffer.from(arrayBuffer));
  } catch (e) {
    return { ok: false, error: '写临时文件失败：' + e.message };
  }

  const started = Date.now();
  const threads = Math.max(2, Math.min(8, os.cpus().length));
  const args = [
    '-m', WHISPER_MODEL,
    '-f', wavPath,
    '-l', 'zh',
    '--prompt', PROMPT,
    '-t', String(threads)
  ];

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const child = spawn(WHISPER_EXE, args, { cwd: WHISPER_DIR, windowsHide: true });

    // 一段音频最多给 20 分钟，别把进程挂死
    const timer = setTimeout(() => {
      if (!done) {
        try { child.kill(); } catch (e) {}
        finish({ ok: false, error: '转写超时（超过 20 分钟）' });
      }
    }, 20 * 60 * 1000);

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { fs.unlinkSync(wavPath); } catch (e) {}
      resolve(result);
    }

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => finish({ ok: false, error: '无法启动 whisper-cli：' + err.message }));
    child.on('close', (code) => {
      log('whisper exit=' + code + ' in ' + (Date.now() - started) + 'ms');
      if (code !== 0) {
        return finish({ ok: false, error: 'whisper-cli 退出码 ' + code + (stderr ? '：' + stderr.slice(-200) : '') });
      }
      const segs = parseSegments(stdout);
      if (!segs.length) {
        return finish({ ok: false, error: '没有识别到语音内容（可能是静音或环境太吵）' });
      }
      finish({ ok: true, segments: segs, ms: Date.now() - started });
    });
  });
});

// 同一个 exe 只允许开一个窗口
const gotLock = app.requestSingleInstanceLock();
log('single instance lock: ' + gotLock);
if (!gotLock) {
  log('another instance is running, quitting');
  app.quit();
}

let mainWin = null;

function createWindow() {
  // 按屏幕可用区域定尺寸，别开出一个比屏幕还大的窗口
  const work = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(960, Math.min(1320, work.width - 60));
  const height = Math.max(640, Math.min(880, work.height - 60));

  mainWin = new BrowserWindow({
    width: width,
    height: height,
    minWidth: Math.min(960, work.width),
    minHeight: Math.min(640, work.height),
    center: true,
    backgroundColor: '#050a12',
    title: '大学生辅助器',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWin.loadFile(path.join(__dirname, 'index.html'));

  // 先隐藏，等页面画好再显示，避免白屏闪一下
  mainWin.once('ready-to-show', () => {
    mainWin.show();
  });

  // 页面里的外链一律丢给系统浏览器，不在应用里开新窗口
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWin.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(() => {
  // 界面是深色，标题栏也跟着深色
  nativeTheme.themeSource = 'dark';
  log('whisper ready: ' + whisperReady());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

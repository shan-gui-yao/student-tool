/*
 * 大学生辅助器 · 桌面外壳
 * 只做三件事：开一个无菜单的窗口、加载 index.html、拦住外部链接。
 * 业务逻辑全部在 index.html 里，桌面版和网页版共用同一份页面。
 */
const { app, BrowserWindow, Menu, shell, screen, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

/*
 * 预加载脚本：只向页面暴露「有没有桌面能力」和「转写」两个入口。
 * 页面拿不到 Node，也拿不到 ipcRenderer 本身。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  // 录音结束后，把 16kHz 单声道 WAV 的 ArrayBuffer 丢过来
  transcribe: (arrayBuffer) => ipcRenderer.invoke('transcribe', arrayBuffer),
  whisperStatus: () => ipcRenderer.invoke('whisper-status')
});

// macOS 保留原有的原生 arm64 啟動方式；其他平台沿用目前 Node，避免依賴 macOS arch 旗標。
// 只組 argv、不經 shell；schema、upload、deploy 的實際命令與失敗處理由呼叫端保留。
export function wranglerCommand(script, args = [], { platform = process.platform, execPath = process.execPath } = {}) {
  return platform === 'darwin'
    ? { command: 'arch', args: ['-arm64', 'node', script, ...args] }
    : { command: execPath, args: [script, ...args] };
}

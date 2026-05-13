import { ipcClient } from './ipc'

export type DiagnosticStatus = 'ok' | 'warning' | 'error'

export type DiagnosticItem = {
  name: string
  status: DiagnosticStatus
  message: string
}

export async function runDiagnostics(): Promise<DiagnosticItem[]> {
  const results: DiagnosticItem[] = []

  try {
    const response = await fetch('http://127.0.0.1:8000/health')
    results.push({
      name: '语音后端',
      status: response.ok ? 'ok' : 'error',
      message: response.ok ? '后端运行正常' : `后端返回 ${response.status}`,
    })
  } catch {
    results.push({ name: '语音后端', status: 'error', message: '无法连接 http://127.0.0.1:8000/health' })
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const microphones = devices.filter((device) => device.kind === 'audioinput')
    results.push({
      name: '麦克风',
      status: microphones.length > 0 ? 'ok' : 'warning',
      message: microphones.length > 0 ? `检测到 ${microphones.length} 个输入设备` : '没有检测到麦克风',
    })
  } catch {
    results.push({ name: '麦克风', status: 'error', message: '无法读取麦克风设备' })
  }

  try {
    const info = await ipcClient.invoke('troubleshooting:get-system-info')
    results.push({ name: '系统信息', status: info ? 'ok' : 'warning', message: info ? '系统信息可读取' : '系统信息为空' })
  } catch {
    results.push({ name: '系统信息', status: 'warning', message: '当前环境无法读取 Electron 系统信息' })
  }

  results.push({
    name: '自动粘贴',
    status: ipcClient.isAvailable() ? 'ok' : 'warning',
    message: ipcClient.isAvailable() ? 'IPC 可用' : '浏览器预览环境无法自动粘贴',
  })

  return results
}

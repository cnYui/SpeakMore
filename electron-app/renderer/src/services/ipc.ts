type IpcListener = (event: unknown, payload: unknown) => void

type ElectronIpcRenderer = {
  invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
  send: (channel: string, payload?: unknown) => void
  on: (channel: string, listener: IpcListener) => void
  off?: (channel: string, listener: IpcListener) => void
  removeListener?: (channel: string, listener: IpcListener) => void
}

function getIpcRenderer(): ElectronIpcRenderer | null {
  return window.ipcRenderer ?? null
}

export const ipcClient = {
  isAvailable() {
    return Boolean(getIpcRenderer())
  },

  invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
    const ipc = getIpcRenderer()
    if (!ipc) {
      return Promise.reject(new Error(`IPC 不可用: ${channel}`))
    }
    return ipc.invoke<T>(channel, payload)
  },

  send(channel: string, payload?: unknown) {
    const ipc = getIpcRenderer()
    if (!ipc) return
    ipc.send(channel, payload)
  },

  on(channel: string, listener: IpcListener) {
    const ipc = getIpcRenderer()
    if (!ipc) return () => {}
    ipc.on(channel, listener)
    return () => {
      if (ipc.off) ipc.off(channel, listener)
      else ipc.removeListener?.(channel, listener)
    }
  },
}

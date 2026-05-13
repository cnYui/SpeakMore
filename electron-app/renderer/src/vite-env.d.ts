/// <reference types="vite/client" />

type IpcRendererListener = (event: unknown, payload: unknown) => void

interface Window {
  ipcRenderer?: {
    invoke: <T = unknown>(channel: string, payload?: unknown) => Promise<T>
    send: (channel: string, payload?: unknown) => void
    on: (channel: string, listener: IpcRendererListener) => void
    off?: (channel: string, listener: IpcRendererListener) => void
    removeListener?: (channel: string, listener: IpcRendererListener) => void
    platform?: string
  }
}

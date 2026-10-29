import { contextBridge, ipcRenderer } from 'electron'
import { API_NAMES, type ApiResult, type Bridge, type LogEvent } from '../shared/api'
import type { ProgressEvent } from '../shared/types'


const bridge: Record<string, unknown> = {}
for (const name of API_NAMES) {
  bridge[name] = async (...args: unknown[]) => {
    const res = (await ipcRenderer.invoke(name, ...args)) as ApiResult<unknown>
    if (res.ok) return res.data
    // код ошибки передаём в тексте: свойства Error через contextBridge не гарантированно сохраняются
    throw new Error(`[${res.error.code}] ${res.error.message}`)
  }
}
const subscribe = <T,>(channel: string) => (cb: (e: T) => void) => {
  const h = (_: unknown, e: T) => cb(e)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}
bridge.onLog = subscribe<LogEvent>('job:log')
bridge.onProgress = subscribe<ProgressEvent>('job:progress')

contextBridge.exposeInMainWorld('api', bridge as unknown as Bridge)

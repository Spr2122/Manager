import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { API_NAMES, type ApiName, type ApiResult } from '../shared/api'
import { createService } from './service'
import { CatalogError } from './catalog'
import { AppError } from './fsutil'

let win: BrowserWindow | null = null

// второй экземпляр мог бы одновременно писать в те же файлы
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })

const devUrl = process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1080, minHeight: 640,
    backgroundColor: '#f5f7fb', title: 'SorbentOpt Manager', autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false
    }
  })
  // интерфейс не должен уходить на чужие адреса и открывать новые окна
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!isOwnUrl(url)) e.preventDefault() })
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null })
}

const isOwnUrl = (url: string) => (devUrl ? url.startsWith(devUrl) : url.startsWith('file://'))

function errorOf(e: unknown): { code: string; message: string } {
  if (e instanceof AppError) return { code: e.code, message: e.message }
  if (e instanceof CatalogError) return { code: 'CATALOG', message: e.message }
  console.error(e)
  return { code: 'UNEXPECTED', message: `Непредвиденная ошибка: ${(e as Error)?.message ?? e}` }
}

if (gotLock) {
  app.whenReady().then(() => {
    const { api, shutdown } = createService(() => win)
    for (const name of API_NAMES) {
      ipcMain.handle(name, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<ApiResult<unknown>> => {
        if (!isOwnUrl(event.senderFrame?.url ?? '')) return { ok: false, error: { code: 'FORBIDDEN', message: 'Запрос из недоверенного источника' } }
        try {
          const fn = api[name as ApiName] as (...a: unknown[]) => Promise<unknown>
          return { ok: true, data: await fn(...args) }
        } catch (e) {
          return { ok: false, error: errorOf(e) }
        }
      })
    }
    app.on('before-quit', shutdown)
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}

import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppConfig, PublicConfig, SecretKind } from '../shared/types'
import type { ConfigPatch } from '../shared/api'
import { AppError, atomicWrite, readJson } from './fsutil'
import { validateRemoteBase } from './deploy'

const DEFAULTS: AppConfig = {
  siteRoot: null,
  siteUrl: 'https://sorbentopt.ru',
  server: { host: '', port: 22, username: 'deploy', authType: 'key', keyPath: '', remoteBase: '/var/www/sorbentopt', keepReleases: 5, fingerprint: '' }
}

const dir = () => app.getPath('userData')
const configFile = () => join(dir(), 'config.json')
const secretsFile = () => join(dir(), 'secrets.json')

export function loadConfig(): AppConfig {
  try {
    if (existsSync(configFile())) {
      const raw = readJson<Partial<AppConfig>>(configFile())
      return { ...DEFAULTS, ...raw, server: { ...DEFAULTS.server, ...(raw.server ?? {}) } }
    }
  } catch { /* повреждённый конфиг — начнём с настроек по умолчанию */ }
  return structuredClone(DEFAULTS)
}

export const saveConfig = (c: AppConfig) => atomicWrite(configFile(), JSON.stringify(c, null, 2))

export function applyPatch(cur: AppConfig, patch: ConfigPatch): AppConfig {
  const next = structuredClone(cur)
  if (patch.siteUrl !== undefined) {
    let u: URL
    try { u = new URL(patch.siteUrl.trim()) } catch { throw new AppError('BAD_CONFIG', 'Адрес сайта указан неверно. Пример: https://sorbentopt.ru') }
    if (!/^https?:$/.test(u.protocol)) throw new AppError('BAD_CONFIG', 'Адрес сайта должен начинаться с https://')
    next.siteUrl = u.origin
  }
  const s = patch.server
  if (s) {
    if (s.host !== undefined) {
      const h = s.host.trim()
      if (h && !/^[A-Za-z0-9.\-:[\]]+$/.test(h)) throw new AppError('BAD_CONFIG', 'Адрес сервера: домен или IP без пробелов и «ssh://»')
      next.server.host = h
    }
    if (s.port !== undefined) {
      if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new AppError('BAD_CONFIG', 'Порт — число от 1 до 65535')
      next.server.port = s.port
    }
    if (s.username !== undefined) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(s.username.trim())) throw new AppError('BAD_CONFIG', 'Имя пользователя: латиница, цифры, «_» и «-»')
      next.server.username = s.username.trim()
    }
    if (s.authType !== undefined) next.server.authType = s.authType === 'password' ? 'password' : 'key'
    if (s.keyPath !== undefined) next.server.keyPath = s.keyPath.trim()
    if (s.remoteBase !== undefined) next.server.remoteBase = validateRemoteBase(s.remoteBase)
    if (s.keepReleases !== undefined) {
      if (!Number.isInteger(s.keepReleases) || s.keepReleases < 2 || s.keepReleases > 30) throw new AppError('BAD_CONFIG', 'Хранить версий: от 2 до 30')
      next.server.keepReleases = s.keepReleases
    }
    // новый сервер — новое доверие: отпечаток нужно подтвердить заново
    if (next.server.host !== cur.server.host || next.server.port !== cur.server.port) next.server.fingerprint = ''
  }
  return next
}

// ───────── секреты (пароль / пассфраза) — только в защищённом хранилище ОС ─────────

type SecretStore = Partial<Record<SecretKind, string>>
const readSecrets = (): SecretStore => { try { return existsSync(secretsFile()) ? readJson<SecretStore>(secretsFile()) : {} } catch { return {} } }

export const secureStorageAvailable = () => safeStorage.isEncryptionAvailable()

export function setSecret(kind: SecretKind, value: string | null): void {
  const all = readSecrets()
  if (value === null || value === '') delete all[kind]
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new AppError('NO_SECURE_STORAGE', 'В системе недоступно защищённое хранилище — пароль нельзя сохранить. Вводите его при каждой выкладке.')
    all[kind] = safeStorage.encryptString(value).toString('base64')
  }
  atomicWrite(secretsFile(), JSON.stringify(all))
}

export function getSecret(kind: SecretKind): string | undefined {
  const enc = readSecrets()[kind]
  if (!enc || !safeStorage.isEncryptionAvailable()) return undefined
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { return undefined }
}

export function publicConfig(c: AppConfig): PublicConfig {
  const s = readSecrets()
  return { ...c, hasPassphrase: !!s.passphrase, hasPassword: !!s.password, secureStorage: safeStorage.isEncryptionAvailable() }
}

export const keyDir = () => { const d = join(dir(), 'ssh'); mkdirSync(d, { recursive: true }); return d }
export const readText = (f: string) => readFileSync(f, 'utf8')

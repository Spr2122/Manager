import { app, dialog, shell, type BrowserWindow } from 'electron'
import { chmodSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { utils } from 'ssh2'
import type {
  AppState, BuildResult, ConnectionResult, DeployResult, Issue, PreflightResult, PriceListsFile, ProductsFile, ReleaseInfo, SiteInfo
} from '../shared/types'
import type { Api, ConfigPatch } from '../shared/api'
import { diffCatalog, priceChangedWithoutDate } from '../shared/diff'
import { validateProducts, validateSettings } from '../shared/validate'
import { formatPrice } from '../shared/price'
import { canonicalSettings } from '../shared/texts'
import { AppError, resolveInside } from './fsutil'
import * as cfgm from './config'
import * as store from './store'
import * as cat from './catalog'
import * as pl from './pricelists'
import { JobLock, runCommand, verifyDist } from './jobs'
import { FingerprintMismatch, connect, generateKeyPair, type Remote } from './remote'
import { checkHealth, currentRelease, deployRelease, listReleases, switchRelease, validateRemoteBase } from './deploy'

type Job = 'install' | 'build' | 'preview' | 'deploy' | 'rollback'

export function createService(getWindow: () => BrowserWindow | null): { api: Api; shutdown: () => void } {
  let config = cfgm.loadConfig()
  const lock = new JobLock()
  let preview: { url: string; abort: AbortController } | null = null

  const send = (channel: string, payload: unknown) => getWindow()?.webContents.send(channel, payload)
  const log = (job: Job) => (line: string) => send('job:log', { job, line })
  const progress = (job: Job) => (phase: string, fraction: number | null) => send('job:progress', { job, phase, fraction })

  const root = (): string => {
    if (!config.siteRoot) throw new AppError('NO_SITE', 'Сначала выберите папку сайта.')
    store.inspectSite(config.siteRoot)
    return config.siteRoot
  }
  const withCatalog = <T>(fn: (r: string, file: ProductsFile) => T): T => { const r = root(); return fn(r, store.readProducts(r)) }

  /** Работа с одним прайсом (по умолчанию — тем, что на сайте): fn получает его товары и возвращает новые. */
  const withList = <T>(listId: string | undefined, fn: (r: string, lists: PriceListsFile, list: ReturnType<typeof pl.getList>) => T): T => {
    const r = root()
    const lists = store.readPriceLists(r)
    return fn(r, lists, pl.getList(lists, listId))
  }

  function state(): AppState {
    let site: SiteInfo | null = null
    let siteError: string | null = null
    if (config.siteRoot) {
      try { site = store.inspectSite(config.siteRoot) } catch (e) { siteError = (e as Error).message }
    }
    return { config: cfgm.publicConfig(config), site, siteError, version: app.getVersion() }
  }

  const productImageIssues = (r: string, file: ProductsFile): Issue[] => {
    const out: Issue[] = []
    for (const p of file.products) {
      if (p.status !== 'published' || !p.image) continue
      try {
        const f = resolveInside(join(r, 'public'), p.image)
        if (existsSync(f) && statSync(f).size > 400 * 1024) {
          out.push({ severity: 'warning', where: `product:${p.id}`, message: `«${p.name}»: изображение весит ${Math.round(statSync(f).size / 1024)} КБ — лучше до 300 КБ (WebP)` })
        }
      } catch { /* путь некорректен — это уже ошибка валидации */ }
    }
    return out
  }

  function serverIssues(): Issue[] {
    const s = config.server
    const out: Issue[] = []
    const err = (message: string) => out.push({ severity: 'error', where: 'server', message, stage: 'deploy' })
    if (!s.host) err('Не указан адрес сервера (Настройки → Сервер).')
    if (s.authType === 'key' && !s.keyPath) err('Не выбран SSH-ключ (Настройки → Сервер → «Создать SSH-ключ»).')
    if (s.host && !s.fingerprint) err('Сервер ещё не подтверждён: нажмите «Проверить подключение» в настройках сервера.')
    if (!config.siteUrl.startsWith('https://')) out.push({ severity: 'warning', where: 'server', message: 'Адрес сайта без https:// — для боевого сайта нужен защищённый адрес.' })
    return out
  }

  function preflight(): PreflightResult {
    const r = root()
    const products = store.readProducts(r)
    const settings = store.readSettings(r)
    const deployed = store.readDeployed(r)
    const issues: Issue[] = [
      ...validateProducts(products, { imageExists: store.imageExistsFn(r) }),
      ...validateSettings(settings),
      ...productImageIssues(r, products),
      ...serverIssues()
    ]
    const now = { products, settings }
    const prev = deployed ? { products: deployed.products, settings: deployed.settings } : null
    if (priceChangedWithoutDate(prev, now)) {
      issues.push({ severity: 'warning', where: 'settings:priceListDate', message: 'Цены изменились, а дата прайса осталась прежней — на сайте будет написано, что прайс актуален на старую дату.' })
    }
    return {
      issues,
      changes: diffCatalog(prev, now),
      build: store.readBuildState(r, config.siteUrl),
      lastDeploy: deployed ? { at: deployed.at, releaseId: deployed.releaseId } : null
    }
  }

  const blocking = (issues: Issue[], forDeploy: boolean) => issues.filter((i) => i.severity === 'error' && (forDeploy || i.stage !== 'deploy'))

  function needDeps(r: string) {
    if (!existsSync(join(r, 'node_modules', 'astro'))) throw new AppError('NO_DEPS', 'Не установлены зависимости сайта. Нажмите «Установить зависимости».')
  }

  // ───────── SSH ─────────
  async function open(opts: { secret?: string; trust?: string } = {}): Promise<Remote> {
    const s = config.server
    if (!s.host) throw new AppError('BAD_CONFIG', 'Не указан адрес сервера (Настройки → Сервер).')
    validateRemoteBase(s.remoteBase)
    const secret = opts.secret ?? cfgm.getSecret(s.authType === 'key' ? 'passphrase' : 'password')
    try {
      return await connect({ cfg: s, secret, trustedFingerprint: opts.trust ?? s.fingerprint })
    } catch (e) {
      if (e instanceof FingerprintMismatch) {
        throw new AppError(
          s.fingerprint ? 'FP_CHANGED' : 'NEED_TRUST',
          s.fingerprint
            ? `ВНИМАНИЕ: отпечаток сервера изменился (был ${s.fingerprint}, сейчас ${e.seen}). Это бывает после переустановки сервера, но может означать подмену. Выкладка остановлена.`
            : `Сервер ещё не подтверждён (отпечаток ${e.seen}). Откройте Настройки → Сервер → «Проверить подключение».`
        )
      }
      throw e
    }
  }

  async function testConnection(opts: { secret?: string; trust?: string } = {}): Promise<ConnectionResult> {
    const s = config.server
    if (!s.host) return { ok: false, message: 'Укажите адрес сервера.' }
    const secret = opts.secret ?? cfgm.getSecret(s.authType === 'key' ? 'passphrase' : 'password')
    let seen = ''
    let remote: Remote
    try {
      remote = await connect({ cfg: s, secret, trustedFingerprint: opts.trust ?? s.fingerprint, onFingerprint: (f) => (seen = f) })
    } catch (e) {
      if (e instanceof FingerprintMismatch) {
        return { ok: false, needsTrust: { fingerprint: e.seen, changed: !!s.fingerprint }, message: s.fingerprint ? 'Отпечаток сервера изменился!' : 'Новый сервер. Сверьте отпечаток и подтвердите доверие.' }
      }
      if ((e as AppError).code === 'NEED_SECRET' || (e as AppError).code === 'SSH_AUTH' || (e as AppError).code === 'SSH') return { ok: false, message: (e as Error).message }
      throw e
    }
    try {
      if (opts.trust && opts.trust === seen && s.fingerprint !== seen) {
        config = { ...config, server: { ...config.server, fingerprint: seen } }
        cfgm.saveConfig(config)
      }
      const details: string[] = []
      const uname = await remote.exec('uname -sr')
      if (uname.code === 0) details.push(`Система: ${uname.stdout.trim()}`)
      const base = validateRemoteBase(s.remoteBase)
      const w = await remote.exec(`test -d '${base}' && test -w '${base}'`)
      details.push(w.code === 0 ? `Папка ${base}: доступна для записи` : `Папка ${base}: НЕТ или нет прав на запись — выполните deploy/setup-vps.sh`)
      const cur = await currentRelease(remote, base)
      details.push(cur ? `Сейчас на сайте версия: ${cur}` : 'Версий на сервере ещё нет')
      return { ok: w.code === 0, message: w.code === 0 ? 'Подключение работает.' : 'Подключились, но папка сайта не готова.', details }
    } finally { remote.close() }
  }

  function generateKey() {
    const priv = join(cfgm.keyDir(), 'id_ed25519')
    if (!existsSync(priv)) {
      const k = generateKeyPair('sorbentopt-manager')
      writeFileSync(priv, k.privateKey + (k.privateKey.endsWith('\n') ? '' : '\n'), { mode: 0o600 })
      try { chmodSync(priv, 0o600) } catch { /* Windows */ }
      writeFileSync(priv + '.pub', k.publicKey + '\n')
    }
    config = cfgm.applyPatch(config, { server: { keyPath: priv, authType: 'key' } })
    cfgm.saveConfig(config)
    return { publicKey: readFileSync(priv + '.pub', 'utf8').trim(), keyPath: priv }
  }

  function getPublicKey(): string | null {
    const k = config.server.keyPath
    if (!k || !existsSync(k)) return null
    if (existsSync(k + '.pub')) return readFileSync(k + '.pub', 'utf8').trim()
    try {
      const parsed = utils.parseKey(readFileSync(k), cfgm.getSecret('passphrase'))
      const key = Array.isArray(parsed) ? parsed[0] : parsed
      if (key instanceof Error) return null
      return `${key.type} ${key.getPublicSSH().toString('base64')}`
    } catch { return null }
  }

  // ───────── сборка и выкладка ─────────
  const npmEnv = (): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, SITE_URL: config.siteUrl, BASE_PATH: '/', ASTRO_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' }
    delete env.PUBLIC_NOINDEX // тестовая настройка не должна попасть на боевой сайт
    return env
  }

  async function build(): Promise<BuildResult> {
    const r = root()
    const pre = preflight()
    const errs = blocking(pre.issues, false)
    if (errs.length) throw new AppError('INVALID', `Нельзя собрать сайт: ${errs.length} ошиб${errs.length === 1 ? 'ка' : 'ки/ок'}. Они перечислены на вкладке «Публикация».`)
    needDeps(r)
    return lock.run('Сборка сайта', async (signal) => {
      const started = Date.now()
      const out = log('build')
      progress('build')('Сборка сайта…', null)
      try { rmSync(join(r, '.manager', 'last-build.json'), { force: true }) } catch { /* */ }
      const code = await runCommand('npm', ['run', 'build'], { cwd: r, env: npmEnv(), onLine: out, signal })
      if (code !== 0) throw new AppError('BUILD', 'Сборка завершилась с ошибкой. Текст ошибки — в журнале выше; чаще всего это ошибка в данных товара.')
      progress('build')('Проверка результата…', null)
      const issues = verifyDist({ root: r, products: store.readProducts(r), siteUrl: config.siteUrl, priceDownload: store.readSettings(r).priceDownload !== false })
      issues.forEach((i) => out(`${i.severity === 'error' ? '✖' : '⚠'} ${i.message}`))
      const ok = !issues.some((i) => i.severity === 'error')
      if (ok) store.writeBuildStamp(r, store.computeDataHash(r, config.siteUrl))
      store.logChange(r, { at: new Date().toISOString(), action: ok ? 'Сайт собран' : 'Сборка не прошла проверку', target: config.siteUrl })
      return { ok, issues, durationMs: Date.now() - started }
    })
  }

  async function deploy(opts: { secret?: string } = {}): Promise<DeployResult> {
    const r = root()
    const pre = preflight()
    const errs = blocking(pre.issues, true)
    if (errs.length) throw new AppError('INVALID', `Выкладка заблокирована: ${errs.length} ошиб${errs.length === 1 ? 'ка' : 'ки/ок'}. Исправьте их на вкладке «Публикация».`)
    if (!pre.build.fresh) throw new AppError('STALE_BUILD', 'Сборка устарела или не выполнялась — данные изменились после последней сборки. Нажмите «Собрать сайт».')
    return lock.run('Выкладка на сервер', async (signal) => {
      const out = log('deploy'), prog = progress('deploy')
      prog('Подключение к серверу…', null)
      const remote = await open(opts)
      try {
        const base = validateRemoteBase(config.server.remoteBase)
        const res = await deployRelease({
          remote, base, localDist: join(r, 'dist'), keep: config.server.keepReleases, signal,
          onProgress: (phase, f) => { prog(phase, f); if (f === null) out(phase) }
        })
        out(`Версия ${res.releaseId} опубликована: ${res.files} файлов, ${(res.bytes / 1048576).toFixed(1)} МБ`)
        store.writeDeployed(r, { at: new Date().toISOString(), releaseId: res.releaseId, products: store.readProducts(r), settings: store.readSettings(r) })
        store.logChange(r, { at: new Date().toISOString(), action: 'Выложено на сервер', target: res.releaseId, details: `${res.files} файлов` })
        prog('Проверка сайта…', null)
        const health = await checkHealth(config.siteUrl, res.releaseId)
        out(health.ok ? '✔ ' + health.message : '⚠ ' + health.message)
        return { ...res, health }
      } finally { remote.close() }
    })
  }

  async function rollback(id: string, opts: { secret?: string } = {}): Promise<DeployResult> {
    const r = root()
    return lock.run('Откат версии', async () => {
      const out = log('rollback')
      const remote = await open(opts)
      try {
        const base = validateRemoteBase(config.server.remoteBase)
        const previousId = await currentRelease(remote, base)
        await switchRelease(remote, base, id)
        out(`Сайт переключён на версию ${id}`)
        store.logChange(r, { at: new Date().toISOString(), action: 'Откат версии на сервере', target: id, details: `было: ${previousId ?? '—'}` })
        // после отката «последняя выкладка» — старая версия, значит сравнение с ней нужно сбросить
        const health = await checkHealth(config.siteUrl, id)
        out(health.ok ? '✔ ' + health.message : '⚠ ' + health.message)
        return { releaseId: id, previousId, files: 0, bytes: 0, health }
      } finally { remote.close() }
    })
  }

  async function startPreview(): Promise<string> {
    const r = root()
    if (preview) return preview.url
    if (!existsSync(join(r, 'dist', 'index.html'))) throw new AppError('NO_BUILD', 'Сначала соберите сайт.')
    needDeps(r)
    const abort = new AbortController()
    const out = log('preview')
    return new Promise<string>((resolve, reject) => {
      let url = ''
      const timer = setTimeout(() => { abort.abort(); reject(new AppError('PREVIEW', 'Предпросмотр не запустился за 20 секунд.')) }, 20_000)
      runCommand('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', '4322'], {
        cwd: r, env: npmEnv(), signal: abort.signal,
        onLine: (l) => {
          out(l)
          const m = !url && /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?/.exec(l)
          if (m) { url = m[0]; clearTimeout(timer); preview = { url, abort }; resolve(url) }
        }
      }).then(() => { preview = null }, (e) => { preview = null; if (!url) { clearTimeout(timer); reject(e) } })
    })
  }

  const stopPreview = () => { preview?.abort.abort(); preview = null }

  const api: Api = {
    getState: async () => state(),
    chooseSite: async () => {
      const r = await dialog.showOpenDialog({ title: 'Папка сайта', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      config = { ...config, siteRoot: r.filePaths[0] }
      cfgm.saveConfig(config)
      return state()
    },
    saveConfig: async (patch: ConfigPatch) => { config = cfgm.applyPatch(config, patch); cfgm.saveConfig(config); return state() },
    setSecret: async (kind, value) => { cfgm.setSecret(kind, value); return state() },
    chooseKeyFile: async () => {
      const r = await dialog.showOpenDialog({ title: 'Приватный SSH-ключ', properties: ['openFile'] })
      return r.canceled ? null : r.filePaths[0]
    },
    generateKey: async () => generateKey(),
    getPublicKey: async () => getPublicKey(),
    testConnection: (o) => testConnection(o),

    listProducts: async () => withCatalog((_r, f) => f),

    listPriceLists: async () => { const r = root(); return store.readPriceLists(r) },
    createPriceList: async (o) => withList(undefined, (r, lists) => {
      const res = pl.createList(lists, o)
      store.writePriceLists(r, res.file, 'Прайс создан', res.list.name, o.copyFromId ? `копия «${pl.getList(lists, o.copyFromId).name}»` : 'пустой')
      return { file: res.file, id: res.list.id }
    }),
    updatePriceList: async (id, patch) => withList(id, (r, lists, list) => {
      const next = pl.updateList(lists, id, patch)
      store.writePriceLists(r, next, 'Прайс изменён', pl.getList(next, id).name, list.name !== pl.getList(next, id).name ? `было: ${list.name}` : undefined)
      return store.readPriceLists(r)
    }),
    deletePriceList: async (id) => withList(id, (r, lists) => {
      const res = pl.deleteList(lists, id)
      store.writePriceLists(r, res.file, 'Прайс удалён', res.removed.name, 'можно вернуть из резервной копии')
      return store.readPriceLists(r)
    }),
    activatePriceList: async (id) => { const r = root(); return store.activatePriceList(r, id) },
    copyProductToList: async (productId, fromId, toId) => withList(fromId, (r, lists) => {
      const res = pl.copyProduct(lists, fromId, productId, toId)
      store.writePriceLists(r, res.file, 'Товар скопирован в другой прайс', res.product.name, `в «${pl.getList(res.file, toId).name}»`)
      return store.readPriceLists(r)
    }),

    saveProduct: async (input, listId) => withList(listId, (r, lists, list) => {
      const res = cat.upsertProduct(pl.asProductsFile(list), input)
      const next = pl.replaceProducts(lists, list.id, res.file.products)
      const where = list.id === lists.activeId ? '' : ` · прайс «${list.name}»`
      store.writePriceLists(r, next, input.id ? 'Товар изменён' : 'Товар добавлен', res.product.name,
        (res.slugChanged ? 'адрес изменён, старый адрес будет перенаправлен' : formatPrice(res.product.price, res.product.priceUnit)) + where)
      return { file: next, slugChanged: res.slugChanged }
    }),
    duplicateProduct: async (id, listId) => withList(listId, (r, lists, list) => {
      const f = pl.asProductsFile(list)
      const res = cat.upsertProduct(f, cat.duplicateInput(f, id))
      const next = pl.replaceProducts(lists, list.id, res.file.products)
      store.writePriceLists(r, next, 'Товар скопирован', res.product.name, list.id === lists.activeId ? undefined : `прайс «${list.name}»`)
      return next
    }),
    deleteProduct: async (id, listId) => withList(listId, (r, lists, list) => {
      const res = cat.deleteProduct(pl.asProductsFile(list), id)
      const next = pl.replaceProducts(lists, list.id, res.file.products)
      store.writePriceLists(r, next, 'Товар удалён', res.removed.name, 'можно вернуть из резервной копии' + (list.id === lists.activeId ? '' : ` · прайс «${list.name}»`))
      return next
    }),
    moveProduct: async (id, dir, listId) => withList(listId, (r, lists, list) => {
      const f = pl.asProductsFile(list)
      const moved = cat.moveProduct(f, id, dir)
      if (moved === f) return lists
      const next = pl.replaceProducts(lists, list.id, moved.products)
      store.writePriceLists(r, next, 'Порядок товаров изменён', f.products.find((p) => p.id === id)?.name ?? '', list.id === lists.activeId ? undefined : `прайс «${list.name}»`)
      return next
    }),

    getSettings: async () => store.readSettings(root()),
    saveSettings: async (s) => {
      const r = root()
      const old = store.readSettings(r)
      const next = canonicalSettings(s)
      const keys = new Set([...Object.keys(old), ...Object.keys(next)]) as Set<keyof typeof s>
      const changed = [...keys].filter((k) => JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null)).join(', ')
      store.writeSettings(r, next, changed || undefined)
      return store.readSettings(r)
    },

    pickImage: async () => {
      const r = root()
      const pick = await dialog.showOpenDialog({ title: 'Изображение товара', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['webp', 'jpg', 'jpeg', 'png', 'avif'] }] })
      if (pick.canceled || !pick.filePaths[0]) return null
      return store.importImage(r, pick.filePaths[0])
    },
    listImages: async () => store.listImages(root()),
    getImage: async (p) => store.imageDataUrl(root(), p),

    preflight: async () => preflight(),
    installDeps: async () => {
      const r = root()
      await lock.run('Установка зависимостей', async (signal) => {
        const useCi = existsSync(join(r, 'package-lock.json'))
        progress('install')('Установка зависимостей…', null)
        const code = await runCommand('npm', [useCi ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: r, onLine: log('install'), signal })
        if (code !== 0) throw new AppError('INSTALL', 'Не удалось установить зависимости. Подробности — в журнале.')
      })
    },
    build,
    startPreview,
    stopPreview: async () => stopPreview(),
    deploy,
    listReleases: async (opts) => {
      root()
      const remote = await open(opts)
      try { return await listReleases(remote, validateRemoteBase(config.server.remoteBase)) as ReleaseInfo[] } finally { remote.close() }
    },
    rollback,
    cancelJob: async () => lock.cancel(),

    getChangelog: async (n) => store.readChangelog(root(), n),
    listBackups: async () => store.listBackups(root()),
    restoreBackup: async (name) => store.restoreBackup(root(), name),
    openSiteUrl: async () => { await shell.openExternal(config.siteUrl) },
    openPreviewUrl: async () => { if (preview) await shell.openExternal(preview.url) },
    openSiteFolder: async () => { await shell.openPath(root()) }
  }
  return { api, shutdown: stopPreview }
}

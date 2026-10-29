// Хранилище: файлы сайта (products.json, settings.json) и служебная папка .manager/ рядом с сайтом.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type {
  BackupInfo, BuildState, ChangeLogEntry, PriceList, PriceListsFile, ProductRecord, ProductsFile, SiteInfo, SiteSettings
} from '../shared/types'
import { canonicalSettings, cleanHidden, cleanTexts } from '../shared/texts'
import { migrateToLists } from './pricelists'
import type { ValidateContext } from '../shared/validate'
import { slugify } from '../shared/slug'
import { AppError, atomicWrite, fileSize, readJson, resolveInside, sha256, stamp } from './fsutil'

const PRODUCTS = 'src/data/products.json'
const SETTINGS = 'src/data/settings.json'
const PRICELISTS = 'src/data/pricelists.json'
const MANAGER = '.manager'
const IMAGE_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.avif'])
const MAX_BACKUPS = 100

const p = (root: string, ...parts: string[]) => join(root, ...parts)

// ───────────────────────── проверка папки сайта ─────────────────────────

export function inspectSite(root: string): SiteInfo {
  if (!existsSync(root)) throw new AppError('SITE_MISSING', 'Папка сайта не найдена. Выберите её заново.')
  if (!existsSync(p(root, PRODUCTS)) || !existsSync(p(root, SETTINGS))) {
    const legacy = existsSync(p(root, 'src/data/products.ts'))
    throw new AppError(
      'SITE_FORMAT',
      legacy
        ? 'Это старая версия сайта (данные в products.ts). Приложению нужна обновлённая папка сайта — с файлами src/data/products.json и settings.json.'
        : 'В этой папке нет файлов src/data/products.json и src/data/settings.json — это не папка сайта СорбентОпт.'
    )
  }
  if (!existsSync(p(root, 'package.json')) || !existsSync(p(root, 'astro.config.mjs'))) {
    throw new AppError('SITE_FORMAT', 'В папке нет package.json или astro.config.mjs — выберите корневую папку сайта.')
  }
  const products = readProducts(root)
  return {
    root,
    productCount: products.products.length,
    publishedCount: products.products.filter((x) => x.status === 'published').length,
    depsInstalled: existsSync(p(root, 'node_modules', 'astro'))
  }
}

// ───────────────────────── чтение и запись данных ─────────────────────────

export function normalizeProduct(raw: Partial<ProductRecord>): ProductRecord {
  return {
    id: String(raw.id ?? ''),
    status: raw.status === 'draft' ? 'draft' : 'published',
    slug: String(raw.slug ?? ''),
    oldSlugs: Array.isArray(raw.oldSlugs) ? raw.oldSlugs.map(String) : [],
    name: String(raw.name ?? ''),
    shortName: String(raw.shortName ?? ''),
    fraction: String(raw.fraction ?? ''),
    packaging: String(raw.packaging ?? ''),
    price: raw.price === null || raw.price === undefined ? null : Number(raw.price),
    priceUnit: String(raw.priceUnit ?? '₽/т'),
    minimum: String(raw.minimum ?? ''),
    image: String(raw.image ?? ''),
    description: String(raw.description ?? ''),
    applications: Array.isArray(raw.applications) ? raw.applications.map(String) : [],
    seoTitle: String(raw.seoTitle ?? ''),
    seoDescription: String(raw.seoDescription ?? '')
  }
}

export function readProducts(root: string): ProductsFile {
  let raw: { schemaVersion?: number; products?: Partial<ProductRecord>[] }
  try {
    raw = readJson(p(root, PRODUCTS))
  } catch (e) {
    throw new AppError('JSON_BROKEN', `Файл products.json повреждён и не читается (${(e as Error).message}). Восстановите его из резервной копии: Настройки → Резервные копии.`)
  }
  if (raw.schemaVersion !== 2 || !Array.isArray(raw.products)) {
    throw new AppError('SITE_FORMAT', 'products.json имеет неподдерживаемый формат (ожидается schemaVersion: 2).')
  }
  return { schemaVersion: 2, products: raw.products.map(normalizeProduct) }
}

export function readSettings(root: string): SiteSettings {
  try {
    const s = readJson<SiteSettings>(p(root, SETTINGS))
    // новые поля всегда присутствуют в памяти (пустые), а в файл пишутся только если ими пользуются
    return { ...s, hiddenContacts: cleanHidden(s.hiddenContacts), texts: cleanTexts(s.texts), pageTexts: s.pageTexts && typeof s.pageTexts === 'object' ? Object.fromEntries(Object.entries(s.pageTexts).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')) : {} }
  } catch (e) {
    throw new AppError('JSON_BROKEN', `Файл settings.json повреждён (${(e as Error).message}). Восстановите его из резервной копии.`)
  }
}

const toJson = (v: unknown) => JSON.stringify(v, null, 2) + '\n'

type BackupKind = 'products' | 'settings' | 'pricelists'
const FILES: Record<BackupKind, string> = { products: PRODUCTS, settings: SETTINGS, pricelists: PRICELISTS }

function backupFile(root: string, kind: BackupKind): void {
  const src = p(root, FILES[kind])
  if (!existsSync(src)) return
  const dir = p(root, MANAGER, 'backups')
  mkdirSync(dir, { recursive: true })
  copyFileSync(src, join(dir, `${kind}-${stamp()}.json`))
  const mine = readdirSync(dir).filter((f) => f.startsWith(kind + '-')).sort()
  for (const old of mine.slice(0, Math.max(0, mine.length - MAX_BACKUPS))) unlinkSync(join(dir, old))
}

export function writeProducts(root: string, file: ProductsFile, action: string, target: string, details?: string): void {
  backupFile(root, 'products')
  atomicWrite(p(root, PRODUCTS), toJson(file))
  logChange(root, { at: new Date().toISOString(), action, target, details })
}

export function writeSettings(root: string, s: SiteSettings, details?: string): void {
  backupFile(root, 'settings')
  atomicWrite(p(root, SETTINGS), toJson(canonicalSettings(s)))
  logChange(root, { at: new Date().toISOString(), action: 'Контент сайта изменён', target: 'Настройки', details })
}

// ───────────────────────── прайсы (группы товаров) ─────────────────────────

function normalizeLists(raw: Partial<PriceListsFile>): PriceListsFile {
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.lists) || raw.lists.length === 0) {
    throw new AppError('JSON_BROKEN', 'Файл pricelists.json имеет неподдерживаемый формат. Восстановите его из резервной копии: Настройки → Резервные копии.')
  }
  const lists: PriceList[] = raw.lists.map((l, i) => ({
    id: String(l.id ?? `pl_${i + 1}`),
    name: String(l.name ?? `Прайс_${i + 1}`),
    priceListDate: String(l.priceListDate ?? ''),
    products: Array.isArray(l.products) ? l.products.map(normalizeProduct) : []
  }))
  const activeId = lists.some((l) => l.id === raw.activeId) ? String(raw.activeId) : lists[0].id
  return { schemaVersion: 1, activeId, lists }
}

/**
 * Читает группы товаров. При первом запуске создаёт pricelists.json: текущий каталог становится «Прайс_1» (на сайте),
 * рядом появляется прайс на 1 февраля 2026 г. products.json остаётся тем, что читает сайт, — это копия активной группы.
 * Если products.json изменили вручную (или восстановили из копии) — активная группа подхватывает эти изменения.
 */
export function readPriceLists(root: string): PriceListsFile {
  const current = readProducts(root).products
  const f = p(root, PRICELISTS)
  if (!existsSync(f)) {
    const migrated = migrateToLists(current, readSettings(root).priceListDate)
    atomicWrite(f, toJson(migrated))
    logChange(root, { at: new Date().toISOString(), action: 'Созданы прайсы', target: migrated.lists.map((l) => l.name).join(', '), details: `на сайте: ${migrated.lists[0].name}` })
    return migrated
  }
  let raw: Partial<PriceListsFile>
  try { raw = readJson(f) } catch (e) {
    throw new AppError('JSON_BROKEN', `Файл pricelists.json повреждён и не читается (${(e as Error).message}). Восстановите его из резервной копии: Настройки → Резервные копии.`)
  }
  const file = normalizeLists(raw)
  const active = file.lists.find((l) => l.id === file.activeId)!
  if (JSON.stringify(active.products) !== JSON.stringify(current)) {
    return { ...file, lists: file.lists.map((l) => (l.id === active.id ? { ...l, products: current } : l)) }
  }
  return file
}

export const activeList = (file: PriceListsFile): PriceList => file.lists.find((l) => l.id === file.activeId)!

/** Сохраняет группы и обновляет products.json (его читает сайт) по активной группе. Одна запись в журнал. */
export function writePriceLists(root: string, file: PriceListsFile, action: string, target: string, details?: string): void {
  backupFile(root, 'pricelists')
  atomicWrite(p(root, PRICELISTS), toJson(file))
  projectActive(root, file)
  logChange(root, { at: new Date().toISOString(), action, target, details })
}

/**
 * Размещает прайс на сайте: products.json становится копией этого прайса, а дата прайса в настройках
 * («Прайс-лист актуален на …») — датой этого прайса, если она в нём указана.
 */
export function activatePriceList(root: string, id: string): PriceListsFile {
  const lists = readPriceLists(root)
  const target = lists.lists.find((l) => l.id === id)
  if (!target) throw new AppError('NO_LIST', 'Прайс не найден — возможно, его удалили в другом окне.')
  const prev = activeList(lists)
  const next: PriceListsFile = { ...lists, activeId: id }
  writePriceLists(root, next, 'Прайс размещён на сайте', target.name, `вместо «${prev.name}»; на сайте появится после выкладки`)
  const settings = readSettings(root)
  if (target.priceListDate && target.priceListDate !== settings.priceListDate) {
    writeSettings(root, { ...settings, priceListDate: target.priceListDate }, `priceListDate (из прайса «${target.name}»)`)
  }
  return readPriceLists(root)
}

function projectActive(root: string, file: PriceListsFile): void {
  const next = toJson({ schemaVersion: 2, products: activeList(file).products } satisfies ProductsFile)
  const f = p(root, PRODUCTS)
  if (!existsSync(f) || readFileSync(f, 'utf8') !== next) atomicWrite(f, next)
}

// ───────────────────────── журнал и резервные копии ─────────────────────────

export function logChange(root: string, entry: ChangeLogEntry): void {
  mkdirSync(p(root, MANAGER), { recursive: true })
  appendFileSync(p(root, MANAGER, 'changelog.jsonl'), JSON.stringify(entry) + '\n')
}

export function readChangelog(root: string, limit: number): ChangeLogEntry[] {
  const f = p(root, MANAGER, 'changelog.jsonl')
  if (!existsSync(f)) return []
  const out: ChangeLogEntry[] = []
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* битая строка журнала не должна ломать приложение */ }
  }
  return out.slice(-limit).reverse()
}

export function listBackups(root: string): BackupInfo[] {
  const dir = p(root, MANAGER, 'backups')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^(products|settings|pricelists)-\d{8}-\d{6}-\d{3}\.json$/.test(f))
    .sort()
    .reverse()
    .map((name) => {
      const m = /^(products|settings|pricelists)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)!
      return {
        name,
        file: m[1] as BackupKind,
        at: new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).toISOString(),
        size: fileSize(join(dir, name))
      }
    })
}

/** Восстановление: текущая версия тоже сохраняется в копии, поэтому восстановление можно «отменить». */
export function restoreBackup(root: string, name: string): void {
  const info = listBackups(root).find((b) => b.name === name)
  if (!info) throw new AppError('NO_BACKUP', 'Резервная копия не найдена')
  const src = p(root, MANAGER, 'backups', name)
  const parsed = readJson<{ schemaVersion?: number }>(src) // убедимся, что копия читается
  if (info.file === 'products') {
    if (parsed.schemaVersion !== 2) throw new AppError('NO_BACKUP', 'Копия имеет неподдерживаемый формат')
    backupFile(root, 'products')
    atomicWrite(p(root, PRODUCTS), toJson(parsed)) // активный прайс подхватит эти данные при следующем чтении
  } else if (info.file === 'pricelists') {
    const lists = normalizeLists(parsed as Partial<PriceListsFile>)
    backupFile(root, 'pricelists')
    atomicWrite(p(root, PRICELISTS), toJson(lists))
    projectActive(root, lists)
  } else {
    backupFile(root, 'settings')
    atomicWrite(p(root, SETTINGS), toJson(parsed))
  }
  logChange(root, { at: new Date().toISOString(), action: 'Восстановлено из резервной копии', target: name })
}

// ───────────────────────── изображения ─────────────────────────

export const imageExistsFn = (root: string): ValidateContext['imageExists'] => (sitePath) => {
  try { return existsSync(resolveInside(p(root, 'public'), sitePath)) } catch { return false }
}

export interface ImportedImage { path: string; sizeKB: number; warning?: string }

export function importImage(root: string, srcFile: string): ImportedImage {
  const ext = extname(srcFile).toLowerCase()
  if (!IMAGE_EXT.has(ext)) throw new AppError('BAD_IMAGE', 'Допустимы форматы WebP, JPG, PNG, AVIF. Лучше всего — WebP.')
  const data = readFileSync(srcFile)
  if (data.length > 10 * 1024 * 1024) throw new AppError('BAD_IMAGE', 'Файл больше 10 МБ — сожмите изображение.')
  const dir = p(root, 'public', 'images', 'products')
  mkdirSync(dir, { recursive: true })
  const base = slugify(basename(srcFile, extname(srcFile))) || 'image'
  const hash = sha256(data)
  let name = `${base}${ext}`
  for (let i = 2; existsSync(join(dir, name)); i++) {
    if (sha256(readFileSync(join(dir, name))) === hash) break // тот же файл уже загружен
    name = `${base}-${i}${ext}`
  }
  if (!existsSync(join(dir, name))) atomicWrite(join(dir, name), data)
  const sizeKB = Math.round(data.length / 1024)
  return {
    path: `/images/products/${name}`,
    sizeKB,
    warning: sizeKB > 400 ? `Файл ${sizeKB} КБ — тяжёлые фото замедляют сайт. Рекомендуется до 300 КБ, формат WebP.` : undefined
  }
}

export function listImages(root: string): string[] {
  const base = p(root, 'public', 'images')
  const out: string[] = []
  const walk = (dir: string, rel: string) => {
    if (!existsSync(dir)) return
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${rel}/${e.name}`)
      else if (IMAGE_EXT.has(extname(e.name).toLowerCase())) out.push(`${rel}/${e.name}`)
    }
  }
  walk(base, '/images')
  return out.sort()
}

const MIME: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif' }

export function imageDataUrl(root: string, sitePath: string): string | null {
  const ext = extname(sitePath).toLowerCase()
  if (!MIME[ext]) return null
  const full = resolveInside(p(root, 'public'), sitePath)
  if (!existsSync(full) || statSync(full).size > 12 * 1024 * 1024) return null
  return `data:${MIME[ext]};base64,${readFileSync(full).toString('base64')}`
}

// ───────────────────────── состояние выкладки и сборки ─────────────────────────

export interface DeployedSnapshot {
  at: string
  releaseId: string
  products: ProductsFile
  settings: SiteSettings
}

export const readDeployed = (root: string): DeployedSnapshot | null => {
  const f = p(root, MANAGER, 'deployed.json')
  try { return existsSync(f) ? readJson<DeployedSnapshot>(f) : null } catch { return null }
}
export const writeDeployed = (root: string, snap: DeployedSnapshot) => atomicWrite(p(root, MANAGER, 'deployed.json'), toJson(snap))

/** Отпечаток всего, что влияет на содержимое сайта: данные, адрес сайта, размеры используемых картинок. */
export function computeDataHash(root: string, siteUrl: string): string {
  const products = readProducts(root)
  const parts = [readFileSync(p(root, PRODUCTS), 'utf8'), readFileSync(p(root, SETTINGS), 'utf8'), siteUrl]
  for (const img of new Set(products.products.map((x) => x.image).filter(Boolean))) {
    try {
      const f = resolveInside(p(root, 'public'), img)
      parts.push(existsSync(f) ? `${img}:${statSync(f).size}:${Math.round(statSync(f).mtimeMs)}` : `${img}:missing`)
    } catch { parts.push(`${img}:bad`) }
  }
  return sha256(parts.join('\n'))
}

interface BuildStamp { builtAt: string; dataHash: string }
export const writeBuildStamp = (root: string, dataHash: string) =>
  atomicWrite(p(root, MANAGER, 'last-build.json'), toJson({ builtAt: new Date().toISOString(), dataHash } satisfies BuildStamp))

export function readBuildState(root: string, siteUrl: string): BuildState {
  const f = p(root, MANAGER, 'last-build.json')
  if (!existsSync(f) || !existsSync(p(root, 'dist', 'index.html'))) return { builtAt: null, fresh: false }
  try {
    const s = readJson<BuildStamp>(f)
    return { builtAt: s.builtAt, fresh: s.dataHash === computeDataHash(root, siteUrl) }
  } catch { return { builtAt: null, fresh: false } }
}

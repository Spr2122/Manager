export type ProductStatus = 'draft' | 'published'

/** Запись товара в src/data/products.json сайта. */
export interface ProductRecord {
  id: string
  status: ProductStatus
  slug: string
  oldSlugs: string[]
  name: string
  shortName: string
  fraction: string
  packaging: string
  /** Рубли за единицу; null = «По запросу». */
  price: number | null
  priceUnit: string
  minimum: string
  image: string
  description: string
  applications: string[]
  seoTitle: string
  seoDescription: string
}

export interface ProductsFile {
  schemaVersion: 2
  products: ProductRecord[]
}

/** Группа товаров («Прайс_1», «Прайс_2»…). На сайт попадает одна — активная. */
export interface PriceList {
  id: string
  name: string
  /** ГГГГ-ММ-ДД. При размещении прайса на сайте становится «датой прайса»; пусто — дату не менять. */
  priceListDate: string
  products: ProductRecord[]
}

/** src/data/pricelists.json. Активная группа дублируется в products.json — его читает сайт. */
export interface PriceListsFile {
  schemaVersion: 1
  activeId: string
  lists: PriceList[]
}

export type ContactId = 'phone' | 'telegram' | 'whatsapp' | 'max' | 'email'

export const CONTACTS: Array<{ id: ContactId; label: string }> = [
  { id: 'phone', label: 'Телефон' }, { id: 'telegram', label: 'Telegram' }, { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'max', label: 'MAX' }, { id: 'email', label: 'Email' }
]

/**
 * Тексты шапки и подвала. Пустое/отсутствующее значение = стандартный текст сайта.
 * Многострочные значения: перенос строки = <br> на сайте.
 */
export interface SiteTexts {
  headerBrand: string
  headerTagline: string
  headerCta: string
  footerBrand: string
  footerTagline: string
  footerAbout: string
  footerRequisites: string
  footerDisclaimer: string
  footerCopyright: string
  footerPolicyLabel: string
}

/** src/data/settings.json сайта. */
export interface SiteSettings {
  schemaVersion: 1
  phone: string
  telegram: string
  whatsapp: string
  maxUrl: string
  maxHandle: string
  email: string
  manufacturerName: string
  manufacturerCity: string
  ownerName: string
  ownerInn: string
  ownerOgrnip: string
  /** ГГГГ-ММ-ДД */
  priceListDate: string
  vatPercent: number
  volumeFromTons: number
  volumeToTons: number
  priceValidUntil: string
  /** Контакты, которые не показываются на сайте (отсутствует = показываются все). */
  hiddenContacts?: ContactId[]
  /** Свои тексты шапки и подвала (отсутствует = стандартные). */
  texts?: Partial<SiteTexts>
  /** Тексты разделов страниц сайта, доступные в редакторе страниц. */
  pageTexts?: Record<string, string>
  /** Кнопка «Скачать прайс-лист» (Excel) на сайте. Отсутствует = включена. */
  priceDownload?: boolean
}

export type Severity = 'error' | 'warning'
export interface Issue {
  severity: Severity
  /** Короткий код, по которому интерфейс может сослаться на место (product:<id>, settings:<field>, build, server). */
  where: string
  message: string
  /** deploy — ошибка не мешает собрать и посмотреть сайт, но запрещает выкладку на боевой домен. */
  stage?: 'deploy'
}

export type ChangeKind = 'added' | 'removed' | 'changed'
export interface Change {
  kind: ChangeKind
  /** Что изменилось: название товара или «Настройки». */
  title: string
  /** Человекочитаемые детали: «цена: 12 000 → 13 500». */
  details: string[]
}

export interface ServerConfig {
  host: string
  port: number
  username: string
  authType: 'key' | 'password'
  keyPath: string
  remoteBase: string
  keepReleases: number
  /** SHA256:… — отпечаток сервера, подтверждённый пользователем. */
  fingerprint: string
}

export interface AppConfig {
  siteRoot: string | null
  siteUrl: string
  server: ServerConfig
}

/** Конфигурация, видимая интерфейсу (секреты наружу не отдаются). */
export interface PublicConfig extends AppConfig {
  hasPassphrase: boolean
  hasPassword: boolean
  secureStorage: boolean
}

export interface SiteInfo {
  root: string
  productCount: number
  publishedCount: number
  depsInstalled: boolean
}

export interface AppState {
  config: PublicConfig
  site: SiteInfo | null
  /** Если выбранная папка не подходит — причина по-русски. */
  siteError: string | null
  version: string
}

export interface BuildState {
  /** Время последней успешной сборки (ISO) или null. */
  builtAt: string | null
  /** Сборка соответствует текущим данным и адресу сайта. */
  fresh: boolean
}

export interface PreflightResult {
  issues: Issue[]
  changes: Change[]
  build: BuildState
  lastDeploy: { at: string; releaseId: string } | null
}

export interface BuildResult {
  ok: boolean
  issues: Issue[]
  durationMs: number
}

export interface ReleaseInfo {
  id: string
  current: boolean
}

export interface DeployResult {
  releaseId: string
  previousId: string | null
  files: number
  bytes: number
  /** Результат проверки «сайт отдаёт новую версию»; null — проверка не проводилась. */
  health: { ok: boolean; message: string } | null
}

export interface ConnectionResult {
  ok: boolean
  /** Заполнено, если сервер новый/изменился и нужно подтверждение пользователя. */
  needsTrust?: { fingerprint: string; changed: boolean }
  message: string
  /** Версия ОС и т.п. для диагностики. */
  details?: string[]
}

export interface BackupInfo {
  name: string
  file: 'products' | 'settings' | 'pricelists'
  at: string
  size: number
}

export interface ChangeLogEntry {
  at: string
  action: string
  target: string
  details?: string
}

export type ProductInput = Omit<ProductRecord, 'id' | 'oldSlugs'> & { id?: string }

export interface ProgressEvent {
  job: 'install' | 'build' | 'preview' | 'deploy' | 'rollback'
  phase: string
  /** 0..1 или null, если неизвестно */
  fraction: number | null
}

export type SecretKind = 'passphrase' | 'password'

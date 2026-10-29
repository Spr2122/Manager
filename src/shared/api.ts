import type {
  AppState, BackupInfo, BuildResult, ChangeLogEntry, ConnectionResult, DeployResult, PreflightResult,
  PriceListsFile, ProductInput, ProductsFile, ProgressEvent, ReleaseInfo, SecretKind, ServerConfig, SiteSettings
} from './types'

export interface ConfigPatch {
  siteUrl?: string
  server?: Partial<Omit<ServerConfig, 'fingerprint'>>
}

export interface ImagePick { path: string; sizeKB: number; warning?: string }

/** Всё, что интерфейс может попросить у основного процесса. */
export interface Api {
  getState(): Promise<AppState>
  chooseSite(): Promise<AppState | null>
  saveConfig(patch: ConfigPatch): Promise<AppState>
  setSecret(kind: SecretKind, value: string | null): Promise<AppState>
  chooseKeyFile(): Promise<string | null>
  generateKey(): Promise<{ publicKey: string; keyPath: string }>
  getPublicKey(): Promise<string | null>
  testConnection(opts?: { secret?: string; trust?: string }): Promise<ConnectionResult>

  /** Товары прайса, который сейчас на сайте. */
  listProducts(): Promise<ProductsFile>

  /** Все прайсы (группы товаров) и номер того, что на сайте. */
  listPriceLists(): Promise<PriceListsFile>
  createPriceList(o: { name: string; priceListDate?: string; copyFromId?: string | null }): Promise<{ file: PriceListsFile; id: string }>
  updatePriceList(id: string, patch: { name?: string; priceListDate?: string }): Promise<PriceListsFile>
  deletePriceList(id: string): Promise<PriceListsFile>
  /** Разместить прайс на сайте (после выкладки). Дата прайса в настройках берётся из прайса, если она в нём указана. */
  activatePriceList(id: string): Promise<PriceListsFile>
  copyProductToList(productId: string, fromListId: string, toListId: string): Promise<PriceListsFile>

  /** Во всех операциях с товарами listId необязателен: без него работаем с прайсом, который на сайте. */
  saveProduct(input: ProductInput, listId?: string): Promise<{ file: PriceListsFile; slugChanged: boolean }>
  duplicateProduct(id: string, listId?: string): Promise<PriceListsFile>
  deleteProduct(id: string, listId?: string): Promise<PriceListsFile>
  moveProduct(id: string, dir: -1 | 1, listId?: string): Promise<PriceListsFile>

  getSettings(): Promise<SiteSettings>
  saveSettings(s: SiteSettings): Promise<SiteSettings>

  pickImage(): Promise<ImagePick | null>
  listImages(): Promise<string[]>
  getImage(sitePath: string): Promise<string | null>

  preflight(): Promise<PreflightResult>
  installDeps(): Promise<void>
  build(): Promise<BuildResult>
  startPreview(): Promise<string>
  stopPreview(): Promise<void>
  deploy(opts?: { secret?: string }): Promise<DeployResult>
  listReleases(opts?: { secret?: string }): Promise<ReleaseInfo[]>
  rollback(id: string, opts?: { secret?: string }): Promise<DeployResult>
  cancelJob(): Promise<void>

  getChangelog(limit: number): Promise<ChangeLogEntry[]>
  listBackups(): Promise<BackupInfo[]>
  restoreBackup(name: string): Promise<void>
  openSiteUrl(): Promise<void>
  openPreviewUrl(): Promise<void>
  openSiteFolder(): Promise<void>
}

export type ApiName = keyof Api
export const API_NAMES: ApiName[] = [
  'getState', 'chooseSite', 'saveConfig', 'setSecret', 'chooseKeyFile', 'generateKey', 'getPublicKey', 'testConnection',
  'listProducts', 'listPriceLists', 'createPriceList', 'updatePriceList', 'deletePriceList', 'activatePriceList', 'copyProductToList',
  'saveProduct', 'duplicateProduct', 'deleteProduct', 'moveProduct', 'getSettings', 'saveSettings',
  'pickImage', 'listImages', 'getImage', 'preflight', 'installDeps', 'build', 'startPreview', 'stopPreview', 'deploy',
  'listReleases', 'rollback', 'cancelJob', 'getChangelog', 'listBackups', 'restoreBackup', 'openSiteUrl', 'openPreviewUrl', 'openSiteFolder'
]

export interface LogEvent { job: ProgressEvent['job']; line: string }

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

/** Что preload добавляет к Api: подписки на события. */
export interface Bridge extends Api {
  onLog(cb: (e: LogEvent) => void): () => void
  onProgress(cb: (e: ProgressEvent) => void): () => void
}

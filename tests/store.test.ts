import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as store from '../src/main/store'
import * as cat from '../src/main/catalog'
import { AppError, resolveInside, atomicWrite } from '../src/main/fsutil'
import { verifyDist } from '../src/main/jobs'
import { hasDist, rm, tempSite } from './helpers'

const dirs: string[] = []
const site = (dist = false) => { const d = tempSite(dist); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rm(dirs.pop()!) })

describe('папка сайта', () => {
  it('распознаёт корректную папку', () => {
    const info = store.inspectSite(site())
    expect(info.productCount).toBe(8); expect(info.publishedCount).toBe(8); expect(info.depsInstalled).toBe(false)
  })
  it('понятные ошибки для неподходящих папок', () => {
    const empty = join(tmpdir(), 'sopt-empty-' + Date.now()); mkdirSync(empty); dirs.push(empty)
    expect(() => store.inspectSite(empty)).toThrow(/не папка сайта/)
    mkdirSync(join(empty, 'src/data'), { recursive: true }); writeFileSync(join(empty, 'src/data/products.ts'), '')
    expect(() => store.inspectSite(empty)).toThrow(/старая версия/)
    expect(() => store.inspectSite(join(empty, 'net'))).toThrow(/не найдена/)
  })
  it('повреждённый JSON — понятная ошибка, а не падение', () => {
    const d = site(); writeFileSync(join(d, 'src/data/products.json'), '{ oops')
    expect(() => store.readProducts(d)).toThrow(/повреждён/)
  })
})

describe('запись данных', () => {
  it('сохраняет атомарно, делает копию и журнал; восстановление обратимо', () => {
    const d = site()
    const before = readFileSync(join(d, 'src/data/products.json'), 'utf8')
    const f = store.readProducts(d)
    const next = cat.upsertProduct(f, { ...f.products[0], name: 'Переименован' })
    store.writeProducts(d, next.file, 'Товар изменён', 'Переименован')
    expect(store.readProducts(d).products[0].name).toBe('Переименован')
    expect(readdirSync(join(d, 'src/data')).filter((x) => x.endsWith('.tmp'))).toEqual([])
    const backups = store.listBackups(d)
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(d, '.manager/backups', backups[0].name), 'utf8')).toBe(before)
    expect(store.readChangelog(d, 5)[0]).toMatchObject({ action: 'Товар изменён', target: 'Переименован' })
    store.restoreBackup(d, backups[0].name)
    expect(store.readProducts(d).products[0].name).toBe(f.products[0].name)
    expect(store.listBackups(d).length).toBe(2) // «состояние до восстановления» тоже сохранено
  })
  it('терпит ручные правки: недостающие поля получают значения по умолчанию', () => {
    const d = site()
    writeFileSync(join(d, 'src/data/products.json'), JSON.stringify({ schemaVersion: 2, products: [{ id: 'p_1', slug: 'a', name: 'A' }] }))
    expect(store.readProducts(d).products[0]).toMatchObject({ oldSlugs: [], applications: [], price: null, priceUnit: '₽/т', status: 'published' })
  })
  it('хеш данных меняется при правке и при замене картинки', () => {
    const d = site()
    const h0 = store.computeDataHash(d, 'https://a.ru')
    expect(store.computeDataHash(d, 'https://a.ru')).toBe(h0)
    expect(store.computeDataHash(d, 'https://b.ru')).not.toBe(h0)
    const f = store.readProducts(d); f.products[0].price = 1; store.writeProducts(d, f, 'x', 'x')
    const h1 = store.computeDataHash(d, 'https://a.ru'); expect(h1).not.toBe(h0)
    writeFileSync(join(d, 'public', f.products[0].image), 'другая картинка')
    expect(store.computeDataHash(d, 'https://a.ru')).not.toBe(h1)
  })
})

describe('безопасность путей и изображения', () => {
  it('не выпускает за пределы public', () => {
    const base = '/tmp/x/public'
    expect(resolveInside(base, '/images/a.webp')).toBe('/tmp/x/public/images/a.webp')
    for (const bad of ['/../secret', '/images/../../secret', 'images/a.webp', '/..']) expect(() => resolveInside(base, bad)).toThrow(AppError)
    const d = site(); expect(store.imageDataUrl(d, '/images/product-1.webp')).toMatch(/^data:image\/webp;base64,/)
    expect(() => store.imageDataUrl(d, '/../../package.json.webp')).toThrow()
    expect(store.imageDataUrl(d, '/package.json')).toBeNull()
  })
  it('импорт: копирует, не дублирует, предупреждает о размере, отвергает чужие форматы', () => {
    const d = site()
    const src = join(d, 'Мой Файл.webp'); writeFileSync(src, Buffer.alloc(500 * 1024, 1))
    const a = store.importImage(d, src)
    expect(a.path).toBe('/images/products/moj-fajl.webp'); expect(a.warning).toMatch(/500 КБ/)
    expect(store.importImage(d, src).path).toBe(a.path) // тот же файл — тот же путь
    const src2 = join(d, 'moj-fajl.webp'); writeFileSync(src2, Buffer.alloc(10, 2))
    expect(store.importImage(d, src2).path).toBe('/images/products/moj-fajl-2.webp')
    const exe = join(d, 'virus.exe'); writeFileSync(exe, 'x')
    expect(() => store.importImage(d, exe)).toThrow(/WebP/)
    expect(store.listImages(d)).toContain('/images/products/moj-fajl.webp')
    expect(store.imageExistsFn(d)('/images/products/moj-fajl.webp')).toBe(true)
    expect(store.imageExistsFn(d)('/../x')).toBe(false)
  })
  it('atomicWrite не оставляет временных файлов', () => {
    const d = site(); const f = join(d, 'a/b/c.json'); atomicWrite(f, '1'); atomicWrite(f, '2')
    expect(readFileSync(f, 'utf8')).toBe('2'); expect(readdirSync(join(d, 'a/b'))).toEqual(['c.json'])
  })
})

describe.skipIf(!hasDist)('проверка собранного сайта (dist)', () => {
  const run = (d: string, url = 'https://sorbentopt.ru') => verifyDist({ root: d, products: store.readProducts(d), siteUrl: url })
  it('корректная сборка проходит без ошибок', () => {
    expect(run(site(true)).filter((i) => i.severity === 'error')).toEqual([])
  })
  it('ловит сборку не для того адреса и тестовые признаки', () => {
    const d = site(true)
    expect(run(d, 'https://example.com').some((i) => /другого адреса/.test(i.message))).toBe(true)
    writeFileSync(join(d, 'dist/robots.txt'), 'User-agent: *\nDisallow: /\n')
    expect(run(d).some((i) => /запрещает индексацию/.test(i.message))).toBe(true)
    const idx = join(d, 'dist/index.html')
    writeFileSync(idx, readFileSync(idx, 'utf8').replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>'))
    expect(run(d).some((i) => /noindex/.test(i.message))).toBe(true)
  })
  it('ловит пропавшую страницу товара и просочившийся черновик', () => {
    const d = site(true)
    const f = store.readProducts(d)
    rmSync(join(d, 'dist/catalog', f.products[0].slug), { recursive: true })
    f.products[1].status = 'draft'; store.writeProducts(d, f, 'x', 'x')
    const m = run(d).map((i) => i.message).join('|')
    expect(m).toMatch(/Нет страницы товара/); expect(m).toMatch(/Черновик .* попал в сборку/)
  })
  it('состояние сборки: свежая → устаревшая после правки данных', () => {
    const d = site(true)
    expect(store.readBuildState(d, 'https://sorbentopt.ru').fresh).toBe(false) // штампа нет
    store.writeBuildStamp(d, store.computeDataHash(d, 'https://sorbentopt.ru'))
    expect(store.readBuildState(d, 'https://sorbentopt.ru').fresh).toBe(true)
    const f = store.readProducts(d); f.products[0].price = 5; store.writeProducts(d, f, 'x', 'x')
    expect(store.readBuildState(d, 'https://sorbentopt.ru').fresh).toBe(false)
    expect(existsSync(join(d, 'dist/index.html'))).toBe(true)
  })
})

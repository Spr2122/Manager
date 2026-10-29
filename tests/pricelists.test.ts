import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as store from '../src/main/store'
import * as cat from '../src/main/catalog'
import * as pl from '../src/main/pricelists'
import { verifyDist } from '../src/main/jobs'
import { PRESET_FEB_2026, PRESET_DEC_2026 } from '../src/main/pricelists'
import { validateProducts, validateSettings } from '../src/shared/validate'
import { diffCatalog } from '../src/shared/diff'
import { canonicalSettings, defaultTexts } from '../src/shared/texts'
import type { PriceListsFile, SiteSettings } from '../src/shared/types'
import { rm, tempSite } from './helpers'

const dirs: string[] = []
const site = () => { const d = tempSite(); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rm(dirs.pop()!) })
const read = (d: string, f: string) => readFileSync(join(d, 'src/data', f), 'utf8')
const prices = (l: { products: Array<{ slug: string; price: number | null }> }) => Object.fromEntries(l.products.map((p) => [p.slug, p.price]))

describe('прайсы: первый запуск', () => {
  it('создаются два прайса: декабрьский активный и февральский; products.json синхронизируется с декабрьским', () => {
    const d = site()
    const before = read(d, 'products.json')
    const f = store.readPriceLists(d)
    expect(f.lists.map((l) => l.name)).toEqual(['Прайс на 1 декабря 2026 г.', 'Прайс на 1 февраля 2026 г.'])
    expect(f.activeId).toBe(f.lists[0].id)
    expect(f.lists[0].priceListDate).toBe('2026-12-01')
    expect(read(d, 'products.json')).not.toBe(before)
    expect(JSON.parse(read(d, 'pricelists.json')).lists).toHaveLength(2)
    // повторное чтение ничего не создаёт заново
    expect(store.readPriceLists(d).lists.map((l) => l.id)).toEqual(f.lists.map((l) => l.id))
  })

  it('Прайс на 1 февраля 2026 г. — цены из файла «Прайс ООО Глауконит на 1 февраля 2026»', () => {
    const f = store.readPriceLists(site())
    const second = f.lists[1]
    expect(second.priceListDate).toBe('2026-02-01')
    expect(prices(second)).toEqual({
      'glaukonit-gr': null,
      'glaukonit-obogashchennyj-0-1-0-9-mm': 13725,
      'glaukonitovyj-koncentrat-dlya-ptitsy': 13725,
      'glaukonitovyj-koncentrat-krs-svini-ovcy': 22000,
      'glaukonit-sorbent-1-5-mm': 10200,
      'glaukonit-sorbent-0-01-0-1-mm': 22000,
      'glaukonitovyj-koncentrat-85': 75000,
      'granulirovannyj-glaukonit-gl-gr-1': null
    })
    // порядок — как в файле
    expect(second.products.map((p) => p.slug)).toEqual(PRESET_FEB_2026.rows.map((r) => r.slug))
  })

  it('карточки берутся из текущего каталога (id сохраняются — в «Публикации» будет видно только изменение цен)', () => {
    const d = site()
    const cur = store.readProducts(d).products
    const second = store.readPriceLists(d).lists[1]
    const a = cur.find((p) => p.slug === 'glaukonit-sorbent-1-5-mm')!
    const b = second.products.find((p) => p.slug === 'glaukonit-sorbent-1-5-mm')!
    expect(b.id).toBe(a.id)
    expect(b.description).toBe(a.description)
    expect(b.price).toBe(10200)
    expect(a.price).toBe(12000)
  })

  it('если в каталоге нет какого-то товара из файла — создаётся из заготовки, остальные не страдают', () => {
    const f = store.readPriceLists(site())
    const cur = f.lists[0].products.filter((p) => p.slug !== 'glaukonitovyj-koncentrat-85')
    const built = pl.buildPresetList(cur, 'pl_x')
    expect(built.products).toHaveLength(8)
    const added = built.products.find((p) => p.slug === 'glaukonitovyj-koncentrat-85')!
    expect(added.price).toBe(75000); expect(added.status).toBe('published'); expect(added.id).toMatch(/^p_/)
    expect(new Set(built.products.map((p) => p.id)).size).toBe(8)
  })

  it('валидный каталог: Прайс_2 проходит те же проверки, что и сайт', () => {
    const f = store.readPriceLists(site())
    const errs = validateProducts({ schemaVersion: 2, products: f.lists[1].products }, { imageExists: () => true }).filter((i) => i.severity === 'error')
    expect(errs).toEqual([])
  })
})

describe('прайсы: работа', () => {
  const setup = () => { const d = site(); return { d, f: store.readPriceLists(d) } }

  it('правки неактивного прайса не трогают products.json (то, что на сайте)', () => {
    const { d, f } = setup()
    const before = read(d, 'products.json')
    const second = f.lists[1]
    const res = cat.upsertProduct(pl.asProductsFile(second), { ...second.products[0], name: 'Переименован во втором' })
    store.writePriceLists(d, pl.replaceProducts(f, second.id, res.file.products), 'Товар изменён', 'x')
    expect(read(d, 'products.json')).toBe(before)
    expect(store.readPriceLists(d).lists[1].products[0].name).toBe('Переименован во втором')
    expect(store.readPriceLists(d).lists[0].products[0].name).not.toBe('Переименован во втором')
  })

  it('правки активного прайса сразу попадают в products.json', () => {
    const { d, f } = setup()
    const first = f.lists[0]
    const res = cat.upsertProduct(pl.asProductsFile(first), { ...first.products[0], price: 99999 })
    store.writePriceLists(d, pl.replaceProducts(f, first.id, res.file.products), 'Товар изменён', 'x')
    expect(store.readProducts(d).products[0].price).toBe(99999)
  })

  it('«разместить на сайте»: products.json = выбранный прайс, дата прайса из прайса; переключение туда и обратно', () => {
    const { d, f } = setup()
    const first = f.lists[0].products.map((p) => p.price)
    const after = store.activatePriceList(d, f.lists[1].id)
    expect(after.activeId).toBe(f.lists[1].id)
    expect(prices(store.readProducts(d))).toEqual(prices(f.lists[1]))
    expect(store.readProducts(d).products.map((p) => p.slug)).toEqual(PRESET_FEB_2026.rows.map((r) => r.slug))
    expect(store.readSettings(d).priceListDate).toBe('2026-02-01')
    store.activatePriceList(d, f.lists[0].id)
    expect(store.readProducts(d).products.map((p) => p.price)).toEqual(first)
    expect(store.readSettings(d).priceListDate).toBe('2026-12-01')
    expect(() => store.activatePriceList(d, 'pl_net')).toThrow(/не найден/)
  })

  it('прайс без даты не трогает дату на сайте', () => {
    const { d, f } = setup()
    const r = pl.updateList(f, f.lists[1].id, { priceListDate: '' })
    store.writePriceLists(d, r, 'x', 'x')
    store.activatePriceList(d, f.lists[1].id)
    expect(store.readSettings(d).priceListDate).toBe('2026-12-01')
  })

  it('после выкладки сравнение показывает именно смену цен, а не «всё удалено и добавлено»', () => {
    const { d, f } = setup()
    const settings = store.readSettings(d)
    const prev = { products: store.readProducts(d), settings }
    store.activatePriceList(d, f.lists[1].id)
    const changes = diffCatalog(prev, { products: store.readProducts(d), settings: store.readSettings(d) })
    expect(changes.filter((c) => c.kind === 'added' || c.kind === 'removed')).toEqual([])
    const sorbent = changes.find((c) => c.title.includes('1–5 мм'))!
    expect(sorbent.details.join()).toMatch(/12\u00a0000.*10\u00a0200/)
  })

  it('создание: копия и пустой; названия уникальны; дата проверяется', () => {
    const { f } = setup()
    const copy = pl.createList(f, { name: 'Прайс_3', copyFromId: f.lists[1].id })
    expect(copy.list.products).toHaveLength(8)
    expect(copy.list.priceListDate).toBe('2026-02-01') // копия наследует дату
    copy.list.products[0].price = 1
    expect(f.lists[1].products[0].price).not.toBe(1) // копия независима
    const empty = pl.createList(copy.file, { name: 'Пустой', priceListDate: '2026-03-01', copyFromId: null })
    expect(empty.list.products).toEqual([])
    expect(() => pl.createList(f, { name: 'прайс_1' })).toThrow(/уже есть/)
    expect(() => pl.createList(f, { name: '  ' })).toThrow(/название/i)
    expect(() => pl.createList(f, { name: 'X', priceListDate: '01.02.2026' })).toThrow(/ГГГГ/)
  })

  it('переименование, удаление; активный прайс удалить нельзя, последний — тоже', () => {
    const { f } = setup()
    const renamed = pl.updateList(f, f.lists[1].id, { name: 'Февраль' })
    expect(renamed.lists[1].name).toBe('Февраль')
    expect(() => pl.updateList(f, f.lists[1].id, { name: 'Прайс_1' })).toThrow(/уже есть/)
    expect(() => pl.deleteList(f, f.activeId)).toThrow(/на сайте/)
    const del = pl.deleteList(f, f.lists[1].id)
    expect(del.file.lists).toHaveLength(1)
    expect(() => pl.deleteList(del.file, del.file.activeId)).toThrow()
  })

  it('копирование товара в другой прайс: id и адрес не конфликтуют', () => {
    const { f } = setup()
    const [a, b] = f.lists
    const empty = pl.createList(f, { name: 'Пустой', copyFromId: null })
    const first = pl.copyProduct(empty.file, a.id, a.products[0].id, empty.list.id)
    expect(first.product.slug).toBe(a.products[0].slug)
    expect(first.product.id).toBe(a.products[0].id)
    const again = pl.copyProduct(first.file, a.id, a.products[0].id, empty.list.id)
    expect(again.product.slug).toBe(`${a.products[0].slug}-2`)
    expect(again.product.id).not.toBe(a.products[0].id)
    expect(() => pl.copyProduct(f, a.id, a.products[0].id, a.id)).toThrow()
    expect(() => pl.copyProduct(f, a.id, 'p_net', b.id)).toThrow(/не найден/)
  })

  it('ручная правка products.json подхватывается активным прайсом', () => {
    const { d } = setup()
    const p = JSON.parse(read(d, 'products.json'))
    p.products[0].price = 12345
    writeFileSync(join(d, 'src/data/products.json'), JSON.stringify(p))
    const f = store.readPriceLists(d)
    expect(f.lists[0].products[0].price).toBe(12345)
    expect(f.lists[1].products[4].price).toBe(10200) // остальные прайсы не затронуты
  })

  it('резервная копия pricelists: восстановление возвращает прайсы и пересобирает products.json', () => {
    const { d, f } = setup()
    const snapshot = read(d, 'pricelists.json')
    store.activatePriceList(d, f.lists[1].id) // создаёт копию с активным Прайс_1
    expect(store.listBackups(d).some((b) => b.file === 'pricelists')).toBe(true)
    const b = store.listBackups(d).filter((x) => x.file === 'pricelists').at(-1)!
    store.restoreBackup(d, b.name)
    expect(store.readPriceLists(d).activeId).toBe(f.lists[0].id)
    expect(JSON.parse(read(d, 'pricelists.json')).activeId).toBe(JSON.parse(snapshot).activeId)
    expect(store.readProducts(d).products.map((p) => p.price)).toEqual(f.lists[0].products.map((p) => p.price))
  })

  it('битый pricelists.json — понятная ошибка', () => {
    const { d } = setup()
    writeFileSync(join(d, 'src/data/pricelists.json'), '{ oops')
    expect(() => store.readPriceLists(d)).toThrow(/повреждён/)
    writeFileSync(join(d, 'src/data/pricelists.json'), JSON.stringify({ schemaVersion: 1, lists: [] }))
    expect(() => store.readPriceLists(d)).toThrow(/формат/)
  })

  it('несуществующий activeId не ломает чтение', () => {
    const { d } = setup()
    const raw: PriceListsFile = JSON.parse(read(d, 'pricelists.json')); raw.activeId = 'pl_ghost'
    writeFileSync(join(d, 'src/data/pricelists.json'), JSON.stringify(raw))
    expect(store.readPriceLists(d).activeId).toBe(raw.lists[0].id)
  })
})

describe('контент: скрытие контактов и тексты', () => {
  const real = (over: Partial<SiteSettings> = {}): SiteSettings => ({
    ...JSON.parse(readFileSync(join(tempSite(), 'src/data/settings.json'), 'utf8')),
    phone: '+79261234567', telegram: 'sorbent_opt', whatsapp: '79261234567', maxUrl: 'https://max.ru/u/abc', maxHandle: '@abc',
    ownerName: 'ИП Иванов И.И.', ownerInn: '123456789012', ownerOgrnip: '123456789012345', priceListDate: '2026-02-01', ...over
  })
  const today = { today: new Date(2026, 9, 27) }

  it('без новых функций settings.json остаётся прежним по составу ключей', () => {
    const d = site()
    const s = store.readSettings(d)
    expect(s.hiddenContacts).toEqual([]); expect(s.texts).toEqual({}) // в памяти — всегда есть
    store.writeSettings(d, s)
    const written = JSON.parse(read(d, 'settings.json'))
    expect(written).not.toHaveProperty('hiddenContacts'); expect(written).not.toHaveProperty('texts')
  })

  it('скрытие пишется в settings.json и читается обратно; пустые тексты не пишутся', () => {
    const d = site()
    const s = store.readSettings(d)
    store.writeSettings(d, { ...s, hiddenContacts: ['max', 'telegram', 'max'], texts: { footerAbout: '  Свой текст ', headerCta: '', footerBrand: '   ' } })
    const written = JSON.parse(read(d, 'settings.json'))
    expect(written.hiddenContacts).toEqual(['telegram', 'max'])
    expect(written.texts).toEqual({ footerAbout: 'Свой текст' })
    expect(store.readSettings(d).hiddenContacts).toEqual(['telegram', 'max'])
    // вернули всё как было — ключи исчезают из файла
    store.writeSettings(d, { ...store.readSettings(d), hiddenContacts: [], texts: {} })
    expect(JSON.parse(read(d, 'settings.json'))).not.toHaveProperty('texts')
  })

  it('скрытый контакт не проверяется и не считается заглушкой — сайт можно выложить без него', () => {
    const s = real({ telegram: 'yourcompany', maxUrl: 'https://max.ru/u/yourcompany', maxHandle: '@yourcompany' })
    expect(validateSettings(s, today).filter((i) => i.stage === 'deploy').map((i) => i.where).sort()).toEqual(['settings:maxHandle', 'settings:maxUrl', 'settings:telegram'])
    const hid = { ...s, hiddenContacts: ['telegram', 'max'] as SiteSettings['hiddenContacts'] }
    expect(validateSettings(hid, today)).toEqual([])
    expect(validateSettings({ ...hid, telegram: '', email: 'плохой' }, today).map((i) => i.where)).toEqual(['settings:email'])
    expect(validateSettings({ ...real({ telegram: '' }), hiddenContacts: ['telegram'] }, today)).toEqual([])
  })

  it('нельзя скрыть все контакты', () => {
    const s = real({ hiddenContacts: ['phone', 'telegram', 'whatsapp', 'max', 'email'] })
    expect(validateSettings(s, today).find((i) => i.where === 'settings:hiddenContacts')?.severity).toBe('error')
    expect(validateSettings({ ...s, hiddenContacts: ['phone', 'telegram', 'whatsapp', 'max'] }, today)).toEqual([])
  })

  it('предупреждает: телефон скрыт, а WhatsApp без номера возьмёт телефон', () => {
    const w = validateSettings(real({ hiddenContacts: ['phone'], whatsapp: '' }), today)
    expect(w).toHaveLength(1); expect(w[0]).toMatchObject({ where: 'settings:whatsapp', severity: 'warning' })
    expect(validateSettings(real({ hiddenContacts: ['phone', 'whatsapp'], whatsapp: '' }), today)).toEqual([])
  })

  it('тексты: длина и заглушки в квадратных скобках', () => {
    const long = validateSettings(real({ texts: { footerCopyright: 'x'.repeat(201) } }), today)
    expect(long[0]).toMatchObject({ where: 'settings:footerCopyright', severity: 'error' })
    expect(long[0].stage).toBeUndefined()
    const br = validateSettings(real({ texts: { footerAbout: 'ИНН [ИНН]' } }), today)
    expect(br[0]).toMatchObject({ where: 'settings:footerAbout', severity: 'error', stage: 'deploy' })
  })

  it('стандартные тексты совпадают с шаблоном подвала сайта', () => {
    const d = defaultTexts(real())
    expect(d.footerTagline).toBe('Прямые поставки с завода ООО «Глауконит» (г. Челябинск) по ценам завода')
    expect(d.footerRequisites.split('\n')).toEqual([
      'ИП Иванов И.И. | ИНН 123456789012 | ОГРНИП 123456789012345',
      'Продукция поставляется напрямую с завода ООО «Глауконит» по ценам завода. Договор поставки заключается с производителем, оплата производится на счёт производителя.'
    ])
    expect(d.footerCopyright).toBe('© 2026 СорбентОпт · ИП Иванов И.И.')
  })

  it('«Публикация» показывает, что скрыто/показано и какие тексты заменены', () => {
    const a = real(), b = real({ hiddenContacts: ['max'], texts: { footerAbout: 'Новый', headerBrand: 'Бренд' } })
    const p = JSON.parse(readFileSync(join(site(), 'src/data/products.json'), 'utf8'))
    const c = diffCatalog({ products: p, settings: a }, { products: p, settings: b }).find((x) => x.title === 'Контент сайта')!
    expect(c.details).toEqual(expect.arrayContaining(['контакт «MAX»: будет скрыт', 'шапка, «Название в шапке»: текст изменён', 'подвал, «Описание компании»: текст изменён']))
    const back = diffCatalog({ products: p, settings: b }, { products: p, settings: a }).find((x) => x.title === 'Контент сайта')!
    expect(back.details).toEqual(expect.arrayContaining(['контакт «MAX»: будет показан', 'подвал, «Описание компании»: вернётся стандартный текст']))
  })

  it('canonicalSettings не мутирует вход и идемпотентна', () => {
    const s = real({ hiddenContacts: ['email'], texts: { footerAbout: 'x' } })
    const snap = JSON.stringify(s)
    const c = canonicalSettings(s)
    expect(JSON.stringify(s)).toBe(snap)
    expect(canonicalSettings(c)).toEqual(c)
  })

  it('кнопка «Скачать прайс»: по умолчанию включена и в файл не пишется; выключение пишется и видно в «Публикации»', () => {
    const d = site()
    const s = store.readSettings(d)
    store.writeSettings(d, { ...s, priceDownload: true })
    expect(JSON.parse(read(d, 'settings.json'))).not.toHaveProperty('priceDownload')
    store.writeSettings(d, { ...s, priceDownload: false })
    expect(JSON.parse(read(d, 'settings.json')).priceDownload).toBe(false)
    const p = store.readProducts(d)
    const c = diffCatalog({ products: p, settings: s }, { products: p, settings: store.readSettings(d) }).find((x) => x.title === 'Контент сайта')!
    expect(c.details).toEqual(['кнопка «Скачать прайс-лист»: будет убрана'])
  })
})

describe('сборка: файл прайса для скачивания', () => {
  const mk = (withRoute: boolean, withFile: boolean) => {
    const d = site()
    mkdirSync(join(d, 'dist'), { recursive: true })
    writeFileSync(join(d, 'dist/index.html'), '<link rel="canonical" href="https://sorbentopt.ru/">')
    if (withRoute) mkdirSync(join(d, 'src/pages/price'), { recursive: true })
    if (withFile) { mkdirSync(join(d, 'dist/price'), { recursive: true }); writeFileSync(join(d, 'dist/price/sorbentopt-price-list.xlsx'), 'x') }
    return d
  }
  const run = (d: string, priceDownload?: boolean) =>
    verifyDist({ root: d, products: { schemaVersion: 2, products: [] }, siteUrl: 'https://sorbentopt.ru', priceDownload }).filter((i) => /прайс-листа для скачивания/.test(i.message))

  it('сайт умеет отдавать прайс, а файла в сборке нет — ошибка', () => { expect(run(mk(true, false))).toHaveLength(1) })
  it('файл есть, кнопка выключена или у сайта нет такой страницы — всё в порядке', () => {
    expect(run(mk(true, true))).toEqual([])
    expect(run(mk(true, false), false)).toEqual([])
    expect(run(mk(false, false))).toEqual([])
  })
})

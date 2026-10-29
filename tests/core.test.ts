import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatPrice, parsePriceInput } from '../src/shared/price'
import { slugify, uniqueSlug } from '../src/shared/slug'
import { validateProducts, validateSettings } from '../src/shared/validate'
import { diffCatalog, priceChangedWithoutDate } from '../src/shared/diff'
import * as cat from '../src/main/catalog'
import type { ProductsFile, SiteSettings } from '../src/shared/types'
import { SITE_SRC } from './helpers'

const load = <T,>(f: string): T => JSON.parse(readFileSync(join(SITE_SRC, 'src/data', f), 'utf8'))
const products = () => load<ProductsFile>('products.json')
const settings = () => load<SiteSettings>('settings.json')
const imgOk = () => true

describe('цена', () => {
  it('форматирует как сайт', () => {
    expect(formatPrice(12000, '₽/т')).toBe('12\u00a0000\u00a0₽/т')
    expect(formatPrice(null, '₽/т')).toBe('По запросу')
    expect(formatPrice(6500.5, '₽/т')).toBe('6\u00a0500,5\u00a0₽/т')
  })
  it('разбирает ввод', () => {
    expect(parsePriceInput('12 000')).toBe(12000)
    expect(parsePriceInput('12000,50 ₽')).toBe(12000.5)
    expect(parsePriceInput('')).toBeNull()
    expect(parsePriceInput('двенадцать')).toBe('invalid')
    expect(parsePriceInput('-5')).toBe('invalid')
    expect(parsePriceInput('1.234')).toBe('invalid')
  })
})

describe('slug', () => {
  it('транслитерирует', () => {
    expect(slugify('Глауконит 1–5 мм')).toBe('glaukonit-1-5-mm')
    expect(slugify('Концентрат «КРС»')).toBe('koncentrat-krs')
    expect(slugify('!!!')).toBe('')
  })
  it('подбирает свободный', () => {
    expect(uniqueSlug('a', ['a', 'a-2'])).toBe('a-3')
    expect(uniqueSlug('b', ['a'])).toBe('b')
  })
})

describe('каталог', () => {
  const base = () => products()
  const input = (over = {}) => {
    const { id: _i, oldSlugs: _o, ...rest } = base().products[0]
    return { ...rest, ...over }
  }
  it('добавляет товар с новым id', () => {
    const r = cat.upsertProduct(base(), input({ name: 'Новый', slug: 'novyj' }))
    expect(r.file.products).toHaveLength(base().products.length + 1)
    expect(r.product.id).toMatch(/^p_[0-9a-f]{10}$/)
  })
  it('slug из названия, если не задан', () => {
    expect(cat.upsertProduct(base(), input({ name: 'Тест Товар', slug: '' })).product.slug).toBe('test-tovar')
  })
  it('смена slug сохраняет старый адрес для редиректа', () => {
    const f = base(); const p = f.products[0]
    const r = cat.upsertProduct(f, { ...input({ slug: 'novyj-adres' }), id: p.id })
    expect(r.slugChanged).toBe(true)
    expect(r.product.oldSlugs).toEqual([p.slug])
    // вернули прежний адрес: он снова основной, а промежуточный мог уже попасть на сайт — его тоже перенаправляем
    const back = cat.upsertProduct(r.file, { ...input({ slug: p.slug }), id: p.id })
    expect(back.product.slug).toBe(p.slug)
    expect(back.product.oldSlugs).toEqual(['novyj-adres'])
  })
  it('не даёт занять чужой адрес, в том числе «старый»', () => {
    const f = base(); const [a, b] = f.products
    expect(() => cat.upsertProduct(f, { ...input({ slug: b.slug }), id: a.id })).toThrow(/занят/)
    const moved = cat.upsertProduct(f, { ...input({ slug: 'novyj-adres' }), id: a.id }).file
    expect(() => cat.upsertProduct(moved, { ...input({ name: 'X', slug: a.slug }) })).toThrow(/занят/)
  })
  it('отвергает плохой адрес, цену и пустое имя', () => {
    expect(() => cat.upsertProduct(base(), input({ slug: 'Bad Slug' }))).toThrow(/латинские/)
    expect(() => cat.upsertProduct(base(), input({ price: -1 }))).toThrow(/цена/i)
    expect(() => cat.upsertProduct(base(), input({ name: '  ' }))).toThrow(/название/)
    expect(() => cat.upsertProduct(base(), { ...input(), id: 'p_nope' })).toThrow(/не найден/)
  })
  it('чистит применения', () => {
    const r = cat.upsertProduct(base(), input({ name: 'Y', slug: 'y', applications: [' а ', 'а', '', 'б'] }))
    expect(r.product.applications).toEqual(['а', 'б'])
  })
  it('удаляет, двигает, дублирует', () => {
    const f = base()
    expect(cat.deleteProduct(f, f.products[0].id).file.products).toHaveLength(f.products.length - 1)
    expect(cat.moveProduct(f, f.products[1].id, -1).products[0].id).toBe(f.products[1].id)
    expect(cat.moveProduct(f, f.products[0].id, -1)).toBe(f) // край списка
    const d = cat.duplicateInput(f, f.products[0].id)
    expect(d.status).toBe('draft')
    const added = cat.upsertProduct(f, d)
    expect(added.product.slug).toBe(`${f.products[0].slug}-copy`)
    expect(cat.upsertProduct(added.file, cat.duplicateInput(added.file, f.products[0].id)).product.slug).toBe(`${f.products[0].slug}-copy-2`)
  })
})

describe('валидация', () => {
  it('текущий каталог сайта валиден', () => {
    expect(validateProducts(products(), { imageExists: imgOk }).filter((i) => i.severity === 'error')).toEqual([])
  })
  it('находит ошибки опубликованного, но терпит черновик', () => {
    const f = products()
    f.products[0].fraction = ''; f.products[0].applications = []
    f.products[1].status = 'draft'; f.products[1].name = ''; f.products[1].image = ''
    const errs = validateProducts(f, { imageExists: imgOk }).filter((i) => i.severity === 'error')
    expect(errs.map((e) => e.message).join('|')).toMatch(/фракция/)
    expect(errs.some((e) => e.where === `product:${f.products[1].id}`)).toBe(false)
    expect(errs.some((e) => /области применения/.test(e.message))).toBe(true)
  })
  it('ловит повтор адресов, id и пропавший файл', () => {
    const f = products()
    f.products[1].slug = f.products[0].slug; f.products[2].id = f.products[3].id
    const m = validateProducts(f, { imageExists: (p) => p !== f.products[4].image }).map((i) => i.message).join('|')
    expect(m).toMatch(/уже используется/); expect(m).toMatch(/id/); expect(m).toMatch(/не найден/)
  })
  it('пустой каталог — ошибка', () => {
    const f = products(); f.products.forEach((p) => (p.status = 'draft'))
    expect(validateProducts(f, { imageExists: imgOk }).some((i) => i.where === 'catalog')).toBe(true)
  })
  it('предупреждает про SEO', () => {
    const f = products(); f.products[0].seoTitle = 'x'.repeat(90); f.products[0].seoDescription = 'коротко'
    const w = validateProducts(f, { imageExists: imgOk }).filter((i) => i.severity === 'warning').map((i) => i.message).join('|')
    expect(w).toMatch(/SEO-заголовок 90/); expect(w).toMatch(/SEO-описание 7/)
  })
  it('настройки: заглушки блокируют, реальные значения проходят', () => {
    const s = settings()
    const errs = validateSettings(s, { today: new Date(2026, 9, 25) }).filter((i) => i.severity === 'error').map((i) => i.where)
    for (const w of ['settings:phone', 'settings:telegram', 'settings:whatsapp', 'settings:maxUrl', 'settings:ownerName', 'settings:ownerInn', 'settings:ownerOgrnip']) expect(errs).toContain(w)
    expect(validateSettings(s).filter((i) => i.where === 'settings:phone')[0].stage).toBe('deploy')
    const real: SiteSettings = { ...s, phone: '+79261234567', telegram: 'sorbent_opt', whatsapp: '79261234567', maxUrl: 'https://max.ru/u/abc', maxHandle: '@abc', ownerName: 'ИП Иванов И.И.', ownerInn: '123456789012', ownerOgrnip: '123456789012345', priceListDate: '2026-10-01' }
    expect(validateSettings(real, { today: new Date(2026, 9, 25) })).toEqual([])
  })
  it('настройки: дата в будущем — предупреждение, формат — ошибка', () => {
    const s = { ...settings(), priceListDate: '2026-12-01' }
    expect(validateSettings(s, { today: new Date(2026, 9, 25) }).find((i) => i.where === 'settings:priceListDate')?.severity).toBe('warning')
    expect(validateSettings({ ...s, priceListDate: '01.12.2026' }).find((i) => i.where === 'settings:priceListDate')?.severity).toBe('error')
    expect(validateSettings({ ...s, vatPercent: 99 }).some((i) => i.where === 'settings:vatPercent')).toBe(true)
    expect(validateSettings({ ...s, volumeFromTons: 50, volumeToTons: 10 }).some((i) => i.where === 'settings:volumeToTons')).toBe(true)
  })
})

describe('сравнение с прошлой выкладкой', () => {
  const snap = () => ({ products: products(), settings: settings() })
  it('без изменений — только пусто', () => {
    expect(diffCatalog(snap(), snap())).toEqual([])
  })
  it('первая выкладка', () => {
    const c = diffCatalog(null, snap())
    expect(c.filter((x) => x.kind === 'added')).toHaveLength(products().products.length + 1)
  })
  it('цена, поля, скрытие, добавление, порядок, настройки', () => {
    const prev = snap(), next = snap()
    next.products.products[0].price = 13500
    next.products.products[0].description += ' ещё'
    next.products.products[1].status = 'draft'
    const added = cat.upsertProduct(next.products, { ...next.products.products[0], id: undefined, slug: 'new-one', name: 'Новый' } as never)
    next.products = added.file
    next.settings.vatPercent = 20
    const text = JSON.stringify(diffCatalog(prev, next))
    expect(text).toMatch(/12\u00a0000.*13\u00a0500/)
    expect(text).toMatch(/описание: изменено/)
    expect(text).toMatch(/removed/); expect(text).toMatch(/Новый/); expect(text).toMatch(/НДС, %: 22 → 20/)
  })
  it('правки черновика сайт не затрагивают', () => {
    const prev = snap(), next = snap()
    prev.products.products[1].status = 'draft'; next.products.products[1].status = 'draft'
    next.products.products[1].price = 1
    expect(diffCatalog(prev, next)).toEqual([])
  })
  it('смена порядка заметна', () => {
    const prev = snap(), next = snap()
    next.products = cat.moveProduct(next.products, next.products.products[3].id, -1)
    expect(JSON.stringify(diffCatalog(prev, next))).toMatch(/порядок/)
  })
  it('цена изменилась без новой даты прайса', () => {
    const prev = snap(), next = snap()
    next.products.products[0].price = 99
    expect(priceChangedWithoutDate(prev, next)).toBe(true)
    next.settings.priceListDate = '2026-12-02'
    expect(priceChangedWithoutDate(prev, next)).toBe(false)
    expect(priceChangedWithoutDate(null, next)).toBe(false)
  })
})

// Чистые операции над группами товаров (прайсами): без файлов и Electron — их легко проверять тестами.
import type { PriceList, PriceListsFile, ProductRecord, ProductsFile } from '../shared/types'
import { newId, uniqueSlug } from '../shared/slug'
import { CatalogError } from './catalog'

export const MAX_NAME = 60
export const listId = () => 'pl_' + newId().slice(2)

// ───────────────────────── прайс ООО «Глауконит» на 1 февраля 2026 г. ─────────────────────────

type Template = Omit<ProductRecord, 'id' | 'oldSlugs' | 'status' | 'seoTitle' | 'seoDescription' | 'price'>
interface PresetRow { slug: string; price: number | null; template: Template }

const T = (o: Omit<Template, 'priceUnit' | 'minimum'>): Template => ({ ...o, priceUnit: '₽/т', minimum: 'От 10 до 1000 тонн' })

/**
 * Строки прайса «ООО Глауконит» (файл «Прайс_ОООГлауконит_2026.docx», с НДС 22%, объём 10–1000 т) в порядке файла.
 * «13.725» в файле — это 13 725 ₽ (точка как разделитель тысяч). Пустая цена в файле — «По запросу».
 * template нужен только если в текущем каталоге такого товара (по адресу страницы) нет.
 */
export const PRESET_FEB_2026: { name: string; date: string; rows: PresetRow[] } = {
  name: 'Прайс на 1 февраля 2026 г.',
  date: '2026-02-01',
  rows: [
    { slug: 'glaukonit-gr', price: null, template: T({ slug: 'glaukonit-gr', name: 'Глауконит марка ГР (в тёплое время года)', shortName: 'Глауконит ГР (тёплое время года)', fraction: 'По спецификации', packaging: 'МКР (биг-бэг) 700 кг', image: '/images/product-1.webp', description: 'Глауконитовая продукция для оптовых поставок. Конкретные параметры и стоимость уточняются по техническому заданию.', applications: ['Промышленность', 'Сельское хозяйство', 'Экология'] }) },
    { slug: 'glaukonit-obogashchennyj-0-1-0-9-mm', price: 13725, template: T({ slug: 'glaukonit-obogashchennyj-0-1-0-9-mm', name: 'Сорбент (глауконит обогащённый) 0,1–0,9 мм', shortName: 'Глауконит обогащённый 0,1–0,9 мм', fraction: '0,1–0,9 мм', packaging: 'Мешок п/п 50 кг', image: '/images/product-2.webp', description: 'Обогащённый глауконит с мелкой фракцией для промышленных, экологических и агротехнических задач.', applications: ['Экология и рекультивация', 'Сельское хозяйство', 'Водоподготовка'] }) },
    { slug: 'glaukonitovyj-koncentrat-dlya-ptitsy', price: 13725, template: T({ slug: 'glaukonitovyj-koncentrat-dlya-ptitsy', name: 'Глауконитовый концентрат на кормовые цели (для птицы)', shortName: 'Концентрат кормовой — для птицы', fraction: 'Кормовая фракция', packaging: 'Мешок п/п 50 кг', image: '/images/product-2.webp', description: 'Глауконитовый концентрат для использования в качестве минеральной кормовой добавки в рационе птицы.', applications: ['Животноводство и птицеводство'] }) },
    { slug: 'glaukonitovyj-koncentrat-krs-svini-ovcy', price: 22000, template: T({ slug: 'glaukonitovyj-koncentrat-krs-svini-ovcy', name: 'Глауконитовый концентрат на кормовые цели, мука (КРС, свиньи, овцы)', shortName: 'Концентрат кормовой — КРС, свиньи, овцы', fraction: 'Мука (тонкий помол)', packaging: 'Мешок п/п', image: '/images/product-3.webp', description: 'Глауконитовый концентрат в виде муки — минеральная кормовая добавка для крупного рогатого скота, свиней и овец.', applications: ['Животноводство и птицеводство'] }) },
    { slug: 'glaukonit-sorbent-1-5-mm', price: 10200, template: T({ slug: 'glaukonit-sorbent-1-5-mm', name: 'Глауконитовый сорбент 1–5 мм', shortName: 'Глауконит сорбент 1–5 мм', fraction: '1–5 мм', packaging: 'МКР (биг-бэг) 750 кг', image: '/images/product-1.webp', description: 'Природный глауконитовый сорбент крупной фракции для оптовых поставок и задач, где требуется работа с гранулированным минеральным материалом.', applications: ['Нефтегазовая и промышленная отрасль', 'Экология и рекультивация', 'Водоподготовка'] }) },
    { slug: 'glaukonit-sorbent-0-01-0-1-mm', price: 22000, template: T({ slug: 'glaukonit-sorbent-0-01-0-1-mm', name: 'Глауконитовый сорбент 0,01–0,1 мм', shortName: 'Глауконит сорбент 0,01–0,1 мм', fraction: '0,01–0,1 мм', packaging: 'Мешок п/п', image: '/images/product-4.webp', description: 'Тонкодисперсная фракция природного глауконита для задач, где требуется материал с малым размером частиц.', applications: ['Промышленная очистка', 'Экология', 'Сельское хозяйство'] }) },
    { slug: 'glaukonitovyj-koncentrat-85', price: 75000, template: T({ slug: 'glaukonitovyj-koncentrat-85', name: 'Глауконитовый концентрат 85%, мука', shortName: 'Глауконитовый концентрат 85%', fraction: 'Мука (тонкий помол)', packaging: 'Мешок п/п', image: '/images/product-5.webp', description: 'Глауконитовый концентрат высокой концентрации (85%) для специализированных промышленных и технологических задач.', applications: ['Промышленность', 'Экология', 'Специализированные минеральные смеси'] }) },
    { slug: 'granulirovannyj-glaukonit-gl-gr-1', price: null, template: T({ slug: 'granulirovannyj-glaukonit-gl-gr-1', name: 'Неорганический сорбент — глауконит гранулированный (Гл-ГР-1)', shortName: 'Гранулированный глауконит Гл-ГР-1', fraction: '1,5×2 – 4×7 мм', packaging: 'Мешок бумажный', image: '/images/product-6.webp', description: 'Гранулированная продукция с заданным диапазоном размеров частиц для оптовых поставок.', applications: ['Сельское хозяйство', 'Экология', 'Промышленные задачи'] }) }
  ]
}

/** Прайс-лист на 1 декабря 2026 г. по изображению, предоставленному пользователем. */
export const PRESET_DEC_2026: { name: string; date: string; rows: PresetRow[] } = {
  name: 'Прайс на 1 декабря 2026 г.',
  date: '2026-12-01',
  rows: PRESET_FEB_2026.rows.map((row, index) => ({
    ...row,
    template: { ...row.template },
    price: [6500, 15000, 15000, 25000, 12000, null, null, null][index]
  }))
}

/**
 * Прайс из файла: берём карточки из `base` (по адресу страницы — текущие описания, фото, SEO остаются как у вас)
 * и проставляем цены из файла. Нет такого товара — создаём из встроенной заготовки. Порядок — как в файле.
 */
export function buildPresetList(base: ProductRecord[], id: string, preset = PRESET_FEB_2026): PriceList {
  const bySlug = new Map<string, ProductRecord>()
  for (const p of base) { bySlug.set(p.slug, p); for (const o of p.oldSlugs) if (!bySlug.has(o)) bySlug.set(o, p) }
  const used = new Set<string>()
  const products = preset.rows.map((row) => {
    const found = bySlug.get(row.slug)
    if (found && !used.has(found.id)) {
      used.add(found.id)
      return { ...found, name: row.template.name, shortName: row.template.shortName, fraction: row.template.fraction, packaging: row.template.packaging, applications: [...found.applications], oldSlugs: [...found.oldSlugs], price: row.price }
    }
    return { id: newId(), oldSlugs: [], status: 'published', seoTitle: '', seoDescription: '', ...row.template, price: row.price } as ProductRecord
  })
  return { id, name: preset.name, priceListDate: preset.date, products }
}

/** Первый запуск: создаются два прайса из подтверждённых пользователем данных; декабрьский — активный. */
export function migrateToLists(current: ProductRecord[], _currentDate: string): PriceListsFile {
  const december = buildPresetList(current, listId(), PRESET_DEC_2026)
  const february = buildPresetList(current, listId(), PRESET_FEB_2026)
  return { schemaVersion: 1, activeId: december.id, lists: [december, february] }
}

// ───────────────────────── операции над группами ─────────────────────────

const cleanName = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()

function checkName(file: PriceListsFile, name: string, exceptId?: string): string {
  const n = cleanName(name)
  if (!n) throw new CatalogError('Укажите название прайса, например «Прайс_3»')
  if (n.length > MAX_NAME) throw new CatalogError(`Название прайса — не длиннее ${MAX_NAME} символов`)
  if (file.lists.some((l) => l.id !== exceptId && l.name.toLowerCase() === n.toLowerCase())) throw new CatalogError(`Прайс «${n}» уже есть — выберите другое название`)
  return n
}

const checkDate = (d: string): string => {
  const t = String(d ?? '').trim()
  if (t && (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t)))) throw new CatalogError('Дата прайса — в формате ГГГГ-ММ-ДД')
  return t
}

export function getList(file: PriceListsFile, id: string | undefined): PriceList {
  const l = file.lists.find((x) => x.id === (id ?? file.activeId))
  if (!l) throw new CatalogError('Прайс не найден — возможно, его удалили в другом окне')
  return l
}

export const asProductsFile = (l: PriceList): ProductsFile => ({ schemaVersion: 2, products: l.products })

export function replaceProducts(file: PriceListsFile, id: string, products: ProductRecord[]): PriceListsFile {
  getList(file, id)
  return { ...file, lists: file.lists.map((l) => (l.id === id ? { ...l, products } : l)) }
}

/** Новый прайс: пустой или копия существующего (товары сохраняют id — так видно, что именно изменилось в ценах). */
export function createList(file: PriceListsFile, o: { name: string; priceListDate?: string; copyFromId?: string | null }): { file: PriceListsFile; list: PriceList } {
  const name = checkName(file, o.name)
  const src = o.copyFromId ? getList(file, o.copyFromId) : null
  const list: PriceList = {
    id: listId(), name, priceListDate: checkDate(o.priceListDate ?? src?.priceListDate ?? ''),
    products: src ? src.products.map((p) => ({ ...p, applications: [...p.applications], oldSlugs: [...p.oldSlugs] })) : []
  }
  return { file: { ...file, lists: [...file.lists, list] }, list }
}

export function updateList(file: PriceListsFile, id: string, patch: { name?: string; priceListDate?: string }): PriceListsFile {
  const cur = getList(file, id)
  const name = patch.name === undefined ? cur.name : checkName(file, patch.name, id)
  const priceListDate = patch.priceListDate === undefined ? cur.priceListDate : checkDate(patch.priceListDate)
  return { ...file, lists: file.lists.map((l) => (l.id === id ? { ...l, name, priceListDate } : l)) }
}

export function deleteList(file: PriceListsFile, id: string): { file: PriceListsFile; removed: PriceList } {
  const removed = getList(file, id)
  if (id === file.activeId) throw new CatalogError('Этот прайс сейчас на сайте — удалить его нельзя. Сначала разместите на сайте другой прайс.')
  return { file: { ...file, lists: file.lists.filter((l) => l.id !== id) }, removed }
}

export function activateList(file: PriceListsFile, id: string): PriceListsFile {
  getList(file, id)
  return { ...file, activeId: id }
}

/** Копирует товар в другой прайс. Адрес страницы в целевом прайсе должен быть свободен — иначе подбирается «-2». */
export function copyProduct(file: PriceListsFile, fromId: string, productId: string, toId: string): { file: PriceListsFile; product: ProductRecord } {
  if (fromId === toId) throw new CatalogError('Выберите другой прайс')
  const src = getList(file, fromId).products.find((p) => p.id === productId)
  if (!src) throw new CatalogError('Товар не найден')
  const to = getList(file, toId)
  const taken = new Set<string>()
  for (const p of to.products) { taken.add(p.slug); p.oldSlugs.forEach((o) => taken.add(o)) }
  const sameId = to.products.some((p) => p.id === src.id)
  const product: ProductRecord = {
    ...src, applications: [...src.applications], oldSlugs: sameId ? [] : [...src.oldSlugs].filter((o) => !taken.has(o)),
    id: sameId ? newId() : src.id, slug: uniqueSlug(src.slug, taken)
  }
  return { file: replaceProducts(file, toId, [...to.products, product]), product }
}

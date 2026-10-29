import type { Change, ProductRecord, ProductsFile, SiteSettings } from './types'
import { formatPrice } from './price'
import { TEXT_FIELDS, cleanHidden, cleanTexts } from './texts'
import { CONTACTS } from './types'

const FIELDS: Array<[keyof ProductRecord, string]> = [
  ['name', 'название'], ['shortName', 'короткое название'], ['slug', 'адрес страницы'], ['fraction', 'фракция'],
  ['packaging', 'упаковка'], ['minimum', 'минимальная партия'], ['image', 'изображение'],
  ['description', 'описание'], ['applications', 'применение'], ['seoTitle', 'SEO-заголовок'], ['seoDescription', 'SEO-описание']
]
const LONG = new Set<keyof ProductRecord>(['description', 'applications', 'seoDescription'])

const SETTINGS_LABELS: Partial<Record<keyof SiteSettings, string>> = {
  phone: 'телефон', telegram: 'Telegram', whatsapp: 'WhatsApp', maxUrl: 'ссылка MAX', maxHandle: 'имя в MAX', email: 'email',
  manufacturerName: 'производитель', manufacturerCity: 'город производителя', ownerName: 'владелец сайта', ownerInn: 'ИНН',
  ownerOgrnip: 'ОГРНИП', priceListDate: 'дата прайса', vatPercent: 'НДС, %', volumeFromTons: 'объём от, т',
  volumeToTons: 'объём до, т', priceValidUntil: 'цена действительна до'
}

const show = (v: unknown) => (Array.isArray(v) ? v.join('; ') : String(v ?? '') || '—')

/**
 * Что увидит посетитель сайта по сравнению с прошлой выкладкой.
 * Черновики для сайта не существуют, поэтому их правки не учитываются.
 */
export function diffCatalog(
  prev: { products: ProductsFile; settings: SiteSettings } | null,
  next: { products: ProductsFile; settings: SiteSettings }
): Change[] {
  const changes: Change[] = []
  const visible = (f: ProductsFile) => f.products.filter((p) => p.status === 'published')
  const prevMap = new Map((prev ? visible(prev.products) : []).map((p) => [p.id, p]))
  const nextList = visible(next.products)
  const nextMap = new Map(nextList.map((p) => [p.id, p]))

  for (const p of nextList) {
    const old = prevMap.get(p.id)
    if (!old) {
      changes.push({ kind: 'added', title: p.name, details: [`цена: ${formatPrice(p.price, p.priceUnit)}`] })
      continue
    }
    const details: string[] = []
    if (old.price !== p.price || old.priceUnit !== p.priceUnit) {
      details.push(`цена: ${formatPrice(old.price, old.priceUnit)} → ${formatPrice(p.price, p.priceUnit)}`)
    }
    for (const [key, title] of FIELDS) {
      if (JSON.stringify(old[key]) === JSON.stringify(p[key])) continue
      details.push(LONG.has(key) ? `${title}: изменено` : `${title}: ${show(old[key])} → ${show(p[key])}`)
    }
    if (details.length) changes.push({ kind: 'changed', title: p.name, details })
  }
  for (const old of prevMap.values()) {
    if (!nextMap.has(old.id)) changes.push({ kind: 'removed', title: old.name, details: ['товар исчезнет с сайта (удалён или скрыт)'] })
  }

  const oldOrder = [...prevMap.keys()].filter((id) => nextMap.has(id))
  const newOrder = nextList.map((p) => p.id).filter((id) => prevMap.has(id))
  if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) {
    changes.push({ kind: 'changed', title: 'Каталог', details: ['изменён порядок товаров'] })
  }

  if (prev) {
    const details: string[] = []
    for (const key of Object.keys(SETTINGS_LABELS) as Array<keyof SiteSettings>) {
      if (prev.settings[key] !== next.settings[key]) details.push(`${SETTINGS_LABELS[key]}: ${show(prev.settings[key])} → ${show(next.settings[key])}`)
    }
    const ph = new Set(cleanHidden(prev.settings.hiddenContacts)), nh = new Set(cleanHidden(next.settings.hiddenContacts))
    for (const c of CONTACTS) {
      if (!ph.has(c.id) && nh.has(c.id)) details.push(`контакт «${c.label}»: будет скрыт`)
      if (ph.has(c.id) && !nh.has(c.id)) details.push(`контакт «${c.label}»: будет показан`)
    }
    const pt = cleanTexts(prev.settings.texts), nt = cleanTexts(next.settings.texts)
    for (const f of TEXT_FIELDS) {
      if (pt[f.key] === nt[f.key]) continue
      details.push(`${f.group === 'header' ? 'шапка' : 'подвал'}, «${f.label}»: ${nt[f.key] ? 'текст изменён' : 'вернётся стандартный текст'}`)
    }
    if ((prev.settings.priceDownload !== false) !== (next.settings.priceDownload !== false)) {
      details.push(`кнопка «Скачать прайс-лист»: будет ${next.settings.priceDownload === false ? 'убрана' : 'показана'}`)
    }
    if (details.length) changes.push({ kind: 'changed', title: 'Контент сайта', details })
  } else {
    changes.push({ kind: 'added', title: 'Контент сайта', details: ['первая выкладка'] })
  }
  return changes
}

/** Цена у опубликованных товаров изменилась, а дата прайса — нет. */
export function priceChangedWithoutDate(
  prev: { products: ProductsFile; settings: SiteSettings } | null,
  next: { products: ProductsFile; settings: SiteSettings }
): boolean {
  if (!prev || prev.settings.priceListDate !== next.settings.priceListDate) return false
  const old = new Map(prev.products.products.filter((p) => p.status === 'published').map((p) => [p.id, p.price]))
  return next.products.products.some((p) => p.status === 'published' && old.has(p.id) && old.get(p.id) !== p.price)
}

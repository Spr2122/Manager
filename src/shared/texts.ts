import type { ContactId, SiteSettings, SiteTexts } from './types'
import { CONTACTS } from './types'

export interface TextField {
  key: keyof SiteTexts
  group: 'header' | 'footer'
  label: string
  hint?: string
  multiline?: boolean
  max: number
}

export const TEXT_FIELDS: TextField[] = [
  { key: 'headerBrand', group: 'header', label: 'Название в шапке', max: 60 },
  { key: 'headerTagline', group: 'header', label: 'Подпись под названием в шапке', max: 200 },
  { key: 'headerCta', group: 'header', label: 'Текст кнопки в шапке', max: 40 },
  { key: 'footerBrand', group: 'footer', label: 'Название в подвале', max: 60 },
  { key: 'footerTagline', group: 'footer', label: 'Подпись под названием в подвале', max: 200 },
  { key: 'footerAbout', group: 'footer', label: 'Описание компании', multiline: true, max: 600 },
  { key: 'footerRequisites', group: 'footer', label: 'Блок «Контакты и реквизиты»', multiline: true, max: 800, hint: 'Каждая строка — с новой строки' },
  { key: 'footerDisclaimer', group: 'footer', label: 'Оговорка (не публичная оферта)', multiline: true, max: 1000 },
  { key: 'footerCopyright', group: 'footer', label: 'Строка с копирайтом', max: 200 },
  { key: 'footerPolicyLabel', group: 'footer', label: 'Ссылка на политику данных', max: 80 }
]

const SUPPLY = (name: string) => `Продукция поставляется напрямую с завода ${name} по ценам завода. Договор поставки заключается с производителем, оплата производится на счёт производителя.`

/**
 * Стандартные тексты — как в шаблоне сайта. Пустая строка: стандартного значения для этого поля
 * приложение не знает (берётся из шаблона сайта), поэтому кнопка «Взять стандартный» для него недоступна.
 */
export function defaultTexts(s: SiteSettings): SiteTexts {
  const rep = `Прямые поставки с завода ${s.manufacturerName} (${s.manufacturerCity}) по ценам завода`
  const owner = `${s.ownerName} | ИНН ${s.ownerInn} | ОГРНИП ${s.ownerOgrnip}`
  return {
    headerBrand: 'СорбентОпт',
    headerTagline: rep,
    headerCta: '',
    footerBrand: 'СорбентОпт',
    footerTagline: rep,
    footerAbout: 'Оптовые поставки глауконитовой продукции по России. Подбор фракции, объёма и условий доставки под задачу клиента.',
    footerRequisites: `${owner}\n${SUPPLY(s.manufacturerName)}`,
    footerDisclaimer: 'Информация на сайте носит ознакомительный характер. Цены и изображения товаров приведены в качестве иллюстрации и не являются публичной офертой (ст. 437 ГК РФ). Актуальную стоимость, спецификации продукции и наличие уточняйте при согласовании объёма заказа.',
    footerCopyright: `© 2026 СорбентОпт · ${s.ownerName}`,
    footerPolicyLabel: 'Политика обработки данных'
  }
}

const CONTACT_IDS = new Set<string>(CONTACTS.map((c) => c.id))

/** Приведение к каноническому виду: только известные ключи, без пустых значений, переводы строк \n. */
export function cleanTexts(raw: unknown): Partial<SiteTexts> {
  const out: Partial<SiteTexts> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const f of TEXT_FIELDS) {
    const v = (raw as Record<string, unknown>)[f.key]
    if (typeof v !== 'string') continue
    const t = v.replace(/\r\n/g, '\n').trim()
    if (t) out[f.key] = t
  }
  return out
}

export function cleanHidden(raw: unknown): ContactId[] {
  if (!Array.isArray(raw)) return []
  const set = new Set(raw.filter((x): x is ContactId => typeof x === 'string' && CONTACT_IDS.has(x)))
  return CONTACTS.map((c) => c.id).filter((id) => set.has(id)) // в порядке сайта, без повторов
}

/** Настройки в том виде, как они лежат в settings.json: новые поля пишутся только если ими пользуются. */
export function canonicalSettings(s: SiteSettings): SiteSettings {
  const { hiddenContacts: _h, texts: _t, pageTexts: _pt, priceDownload: _p, ...rest } = s
  const hidden = cleanHidden(s.hiddenContacts)
  const texts = cleanTexts(s.texts)
  const pageTexts: Record<string, string> = {}
  if (s.pageTexts && typeof s.pageTexts === 'object') for (const [k, v] of Object.entries(s.pageTexts)) { if (/^[a-z0-9]+(?:\.[a-z0-9]+)+$/i.test(k) && typeof v === 'string' && v.trim()) pageTexts[k] = v.replace(/\r\n/g, '\n').trim() }
  return { ...rest, schemaVersion: 1, ...(hidden.length ? { hiddenContacts: hidden } : {}), ...(Object.keys(texts).length ? { texts } : {}), ...(Object.keys(pageTexts).length ? { pageTexts } : {}), ...(s.priceDownload === false ? { priceDownload: false } : {}) }
}

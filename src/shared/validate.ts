import type { ContactId, Issue, ProductRecord, ProductsFile, SiteSettings } from './types'
import { CONTACTS } from './types'
import { SLUG_RE } from './slug'
import { TEXT_FIELDS, cleanHidden } from './texts'

export interface ValidateContext {
  /** Проверка наличия файла в public/ сайта; путь вида /images/x.webp. */
  imageExists: (sitePath: string) => boolean
  today?: Date
}

const label = (p: ProductRecord) => p.name?.trim() || p.slug || p.id || '(без названия)'

/**
 * Те же правила, что при сборке сайта (src/data/products.ts), плюс предупреждения по качеству.
 * Ошибки (error) блокируют выкладку: сайт с ними либо не соберётся, либо будет выглядеть сломанным.
 */
export function validateProducts(file: ProductsFile, ctx: ValidateContext): Issue[] {
  const issues: Issue[] = []
  const add = (severity: Issue['severity'], p: ProductRecord, message: string) =>
    issues.push({ severity, where: `product:${p.id}`, message: `«${label(p)}»: ${message}` })

  const ids = new Map<string, number>()
  const slugOwner = new Map<string, string>()
  for (const p of file.products) ids.set(p.id, (ids.get(p.id) ?? 0) + 1)

  for (const p of file.products) {
    if (!p.id || (ids.get(p.id) ?? 0) > 1) add('error', p, 'пустой или повторяющийся внутренний id')
    if (!SLUG_RE.test(p.slug ?? '')) add('error', p, 'адрес страницы (slug) должен состоять из латинских букв, цифр и дефисов')
    for (const s of [p.slug, ...(p.oldSlugs ?? [])]) {
      if (!s) continue
      const owner = slugOwner.get(s)
      if (owner && owner !== p.id) add('error', p, `адрес «${s}» уже используется другим товаром`)
      slugOwner.set(s, p.id)
    }
    if (p.price !== null && (typeof p.price !== 'number' || !Number.isFinite(p.price) || p.price < 0)) {
      add('error', p, 'цена должна быть числом не меньше нуля либо пустой («По запросу»)')
    }

    if (p.status !== 'published') continue // у черновика допускается неполнота

    const required: Array<[keyof ProductRecord, string]> = [
      ['name', 'название'], ['shortName', 'короткое название'], ['fraction', 'фракция'],
      ['packaging', 'упаковка'], ['minimum', 'минимальная партия'], ['description', 'описание']
    ]
    for (const [key, title] of required) {
      const v = p[key]
      if (typeof v !== 'string' || !v.trim()) add('error', p, `не заполнено поле «${title}»`)
    }
    if (!p.image?.startsWith('/')) add('error', p, 'не выбрано изображение')
    else if (!ctx.imageExists(p.image)) add('error', p, `файл изображения не найден: public${p.image}`)
    if (!Array.isArray(p.applications) || p.applications.filter((a) => a.trim()).length === 0) {
      add('error', p, 'не указаны области применения')
    }

    if (p.description && p.description.trim().length < 80) add('warning', p, 'описание очень короткое — для поиска лучше от 80 символов')
    if (p.seoTitle && p.seoTitle.length > 70) add('warning', p, `SEO-заголовок ${p.seoTitle.length} зн. — поисковики обрежут после ~70`)
    if (p.seoDescription && (p.seoDescription.length > 170 || p.seoDescription.length < 50)) {
      add('warning', p, `SEO-описание ${p.seoDescription.length} зн. — оптимально 50–170`)
    }
    if (p.price !== null && !p.priceUnit.trim()) add('warning', p, 'не указана единица цены (например, ₽/т)')
  }

  if (!file.products.some((p) => p.status === 'published')) {
    issues.push({ severity: 'error', where: 'catalog', message: 'Нет ни одного опубликованного товара — каталог на сайте будет пустым' })
  }
  return issues
}

const PLACEHOLDERS: Array<[RegExp, string]> = [
  [/yourcompany/i, 'похоже на заглушку «yourcompany»'],
  [/\[[^\]]+\]/, 'в значении остались квадратные скобки-заглушка'],
  [/^\+?79991234567$/, 'это номер-заглушка 999 123-45-67']
]

export const SETTINGS_FIELD_LABELS: Record<string, string> = {
  phone: 'Телефон', whatsapp: 'WhatsApp', email: 'Email', telegram: 'Telegram', maxUrl: 'Ссылка MAX', maxHandle: 'Имя в MAX',
  manufacturerName: 'Производитель', manufacturerCity: 'Город производителя', ownerName: 'Владелец сайта', ownerInn: 'ИНН',
  ownerOgrnip: 'ОГРНИП', priceListDate: 'Дата прайса', priceValidUntil: 'Цена действительна до', vatPercent: 'НДС',
  volumeFromTons: 'Объём от', volumeToTons: 'Объём до', hiddenContacts: 'Контакты', priceDownload: 'Скачать прайс',
  ...Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, f.label]))
}

export function validateSettings(s: SiteSettings, ctx: Pick<ValidateContext, 'today'> = {}): Issue[] {
  const issues: Issue[] = []
  const add = (severity: Issue['severity'], field: string, message: string, stage?: 'deploy') =>
    issues.push({ severity, where: `settings:${field}`, message, ...(stage ? { stage } : {}) })

  // скрытые контакты на сайте не показываются — их значения не проверяем и заглушками не считаем
  const hidden = new Set(cleanHidden(s.hiddenContacts))
  const shown = (id: ContactId) => !hidden.has(id)

  if (shown('phone') && !/^\+\d{10,15}$/.test(s.phone)) add('error', 'phone', 'Телефон — в международном формате, например +79991234567')
  if (shown('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) add('error', 'email', 'Некорректный адрес электронной почты')
  if (shown('telegram') && !s.telegram.trim()) add('error', 'telegram', 'Не указан Telegram')
  if (shown('whatsapp') && s.whatsapp && !/^\d{10,15}$/.test(s.whatsapp)) add('error', 'whatsapp', 'WhatsApp — только цифры, например 79991234567')
  if (shown('whatsapp') && !s.whatsapp && hidden.has('phone')) {
    add('warning', 'whatsapp', 'Номер WhatsApp пуст — на сайте будет номер телефона, хотя телефон скрыт. Укажите номер WhatsApp или скройте и его.')
  }
  if (shown('max') && s.maxUrl && !/^https:\/\/\S+$/.test(s.maxUrl)) add('error', 'maxUrl', 'Ссылка MAX должна начинаться с https://')
  if (hidden.size >= CONTACTS.length) add('error', 'hiddenContacts', 'Скрыты все способы связи — на сайте не останется ни одного контакта. Покажите хотя бы один.')
  for (const f of ['manufacturerName', 'manufacturerCity', 'ownerName', 'ownerInn', 'ownerOgrnip'] as const) {
    if (!String(s[f]).trim()) add('error', f, 'Поле не заполнено')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.priceListDate) || Number.isNaN(Date.parse(s.priceListDate))) {
    add('error', 'priceListDate', 'Дата прайса — в формате ГГГГ-ММ-ДД')
  } else {
    const now = ctx.today ?? new Date()
    const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    if (Date.parse(s.priceListDate) > todayUtc) {
      add('warning', 'priceListDate', 'Дата прайса в будущем — на сайте будет написано «актуален на» дату, которая ещё не наступила')
    }
  }
  if (s.priceValidUntil && !/^\d{4}-\d{2}-\d{2}$/.test(s.priceValidUntil)) add('error', 'priceValidUntil', 'Формат ГГГГ-ММ-ДД или пусто')
  if (!(s.vatPercent >= 0 && s.vatPercent <= 30)) add('error', 'vatPercent', 'НДС — число от 0 до 30')
  if (!(s.volumeFromTons > 0 && s.volumeToTons >= s.volumeFromTons)) add('error', 'volumeToTons', 'Объём «от» должен быть больше нуля и не больше «до»')

  // тексты шапки и подвала
  for (const f of TEXT_FIELDS) {
    const v = s.texts?.[f.key]
    if (typeof v !== 'string' || !v) continue
    if (v.length > f.max) add('error', f.key, `Слишком длинный текст: ${v.length} зн., не больше ${f.max}`)
    if (/\[[^\]]+\]/.test(v)) add('error', f.key, 'Не заменена заглушка: в тексте остались квадратные скобки', 'deploy')
  }

  // заглушки, которые нельзя выкладывать на боевой сайт
  const check: Array<[keyof SiteSettings, ContactId | null]> = [
    ['phone', 'phone'], ['telegram', 'telegram'], ['whatsapp', 'whatsapp'], ['maxUrl', 'max'], ['maxHandle', 'max'],
    ['ownerName', null], ['ownerInn', null], ['ownerOgrnip', null]
  ]
  for (const [f, contact] of check) {
    if (contact && hidden.has(contact)) continue
    const v = String(s[f] ?? '')
    if (!v) continue
    const hit = PLACEHOLDERS.find(([re]) => re.test(v))
    if (hit) add('error', f, `Не заменено значение-заглушка: ${hit[1]}`, 'deploy')
  }
  return issues
}

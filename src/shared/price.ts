const NBSP = '\u00a0'

/** 12000 → «12 000 ₽/т»; null → «По запросу». Совпадает с форматированием на сайте. */
export function formatPrice(price: number | null, unit: string): string {
  if (price === null || price === undefined) return 'По запросу'
  const n = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(price).replace(/\s/g, NBSP)
  return unit ? `${n}${NBSP}${unit}` : `${n}${NBSP}₽`
}

/** Разбор введённой пользователем цены: «12 000», «12000,50», «12 000 ₽» → число; пусто → null. */
export function parsePriceInput(text: string): number | null | 'invalid' {
  const cleaned = text.replace(/[\s\u00a0₽рубР.]*$/g, '').replace(/[\s\u00a0]/g, '').replace(',', '.')
  if (cleaned === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return 'invalid'
  return Number(cleaned)
}

// Чистые операции над каталогом (без файлов и Electron) — их легко проверять тестами.
import type { ProductInput, ProductRecord, ProductsFile } from '../shared/types'
import { newId, slugify, uniqueSlug, SLUG_RE } from '../shared/slug'

export class CatalogError extends Error {}

const clean = (s: unknown) => String(s ?? '').replace(/\r\n/g, '\n').trim()

export function normalizeInput(input: ProductInput): Omit<ProductRecord, 'id' | 'oldSlugs'> {
  const applications = Array.from(new Set((input.applications ?? []).map(clean).filter(Boolean)))
  return {
    status: input.status === 'published' ? 'published' : 'draft',
    slug: clean(input.slug).toLowerCase(),
    name: clean(input.name),
    shortName: clean(input.shortName),
    fraction: clean(input.fraction),
    packaging: clean(input.packaging),
    price: input.price === null || input.price === undefined ? null : Number(input.price),
    priceUnit: clean(input.priceUnit),
    minimum: clean(input.minimum),
    image: clean(input.image),
    description: clean(input.description),
    applications,
    seoTitle: clean(input.seoTitle),
    seoDescription: clean(input.seoDescription)
  }
}

function takenSlugs(file: ProductsFile, exceptId?: string): Set<string> {
  const s = new Set<string>()
  for (const p of file.products) {
    if (p.id === exceptId) continue
    s.add(p.slug)
    p.oldSlugs.forEach((o) => s.add(o))
  }
  return s
}

/** Создаёт или обновляет товар. При смене адреса старый уходит в oldSlugs (для редиректа). */
export function upsertProduct(file: ProductsFile, input: ProductInput): { file: ProductsFile; product: ProductRecord; slugChanged: boolean } {
  const data = normalizeInput(input)
  if (!data.name) throw new CatalogError('Укажите название товара')
  if (!data.slug) data.slug = slugify(data.name)
  if (!SLUG_RE.test(data.slug)) throw new CatalogError('Адрес страницы: только латинские буквы, цифры и дефисы, например glaukonit-1-5-mm')
  if (data.price !== null && (!Number.isFinite(data.price) || data.price < 0)) throw new CatalogError('Некорректная цена')

  const existing = input.id ? file.products.find((p) => p.id === input.id) : undefined
  if (input.id && !existing) throw new CatalogError('Товар не найден — возможно, его удалили в другом окне')
  if (takenSlugs(file, existing?.id).has(data.slug)) throw new CatalogError(`Адрес «${data.slug}» уже занят другим товаром`)

  if (!existing) {
    const product: ProductRecord = { id: newId(), oldSlugs: [], ...data }
    return { file: { ...file, products: [...file.products, product] }, product, slugChanged: false }
  }
  const slugChanged = existing.slug !== data.slug
  const oldSlugs = slugChanged
    ? Array.from(new Set([...existing.oldSlugs, existing.slug])).filter((s) => s !== data.slug)
    : existing.oldSlugs
  const product: ProductRecord = { ...existing, ...data, id: existing.id, oldSlugs }
  return { file: { ...file, products: file.products.map((p) => (p.id === existing.id ? product : p)) }, product, slugChanged }
}

export function deleteProduct(file: ProductsFile, id: string): { file: ProductsFile; removed: ProductRecord } {
  const removed = file.products.find((p) => p.id === id)
  if (!removed) throw new CatalogError('Товар не найден')
  return { file: { ...file, products: file.products.filter((p) => p.id !== id) }, removed }
}

export function moveProduct(file: ProductsFile, id: string, dir: -1 | 1): ProductsFile {
  const i = file.products.findIndex((p) => p.id === id)
  if (i < 0) throw new CatalogError('Товар не найден')
  const j = i + dir
  if (j < 0 || j >= file.products.length) return file
  const list = [...file.products]
  ;[list[i], list[j]] = [list[j], list[i]]
  return { ...file, products: list }
}

/** Для кнопки «Дублировать»: копия-черновик с новым адресом. */
export function duplicateInput(file: ProductsFile, id: string): ProductInput {
  const src = file.products.find((p) => p.id === id)
  if (!src) throw new CatalogError('Товар не найден')
  const { id: _id, oldSlugs: _old, ...rest } = src
  return { ...rest, name: `${src.name} (копия)`, status: 'draft', slug: uniqueSlug(`${src.slug}-copy`, takenSlugs(file)) }
}

const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** «Глауконит 1–5 мм» → «glaukonit-1-5-mm». */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => (ch in MAP ? MAP[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

/** Подбирает свободный slug: base, base-2, base-3… */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

export function newId(): string {
  const bytes = new Uint8Array(5)
  globalThis.crypto.getRandomValues(bytes)
  return 'p_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

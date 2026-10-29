import type { Bridge } from '../../shared/api'

export const api: Bridge = window.api

export interface ParsedError { code: string; message: string }
/** Основной процесс присылает ошибку как «[КОД] текст». */
export function parseError(e: unknown): ParsedError {
  const raw = (e as Error)?.message ?? String(e)
  const m = /(?:Error invoking remote method '[^']+': )?(?:Error: )?\[([A-Z_]+)\] ([\s\S]*)$/.exec(raw)
  return m ? { code: m[1], message: m[2] } : { code: 'UNEXPECTED', message: raw }
}

// Nigerian mobile numbers: national number is 10 digits — 1st digit 7/8/9, 2nd 0/1.
// Accepts 08012345678, 8012345678, +2348012345678, 2348012345678 (spaces/dashes ok).
const CORE = /^[789][01]\d{8}$/

export function normalizeNgPhone(input: string): string | null {
  let d = input.replace(/[\s-]/g, "")
  if (d.startsWith("+234")) d = d.slice(4)
  else if (d.startsWith("234")) d = d.slice(3)
  else if (d.startsWith("0")) d = d.slice(1)
  return CORE.test(d) ? `+234${d}` : null
}

export const isValidNgPhone = (input: string) => normalizeNgPhone(input) !== null

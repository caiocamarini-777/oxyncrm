export function onlyDigits(s: string): string {
  return s.replace(/\D/g, "");
}

export function isValidCnpj(cnpj: string): boolean {
  const d = onlyDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const check = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** Máscara progressiva: aceita entrada parcial. */
export function formatCnpj(digits: string): string {
  const d = onlyDigits(digits).slice(0, 14);
  let out = d.slice(0, 2);
  if (d.length > 2) out += "." + d.slice(2, 5);
  if (d.length > 5) out += "." + d.slice(5, 8);
  if (d.length > 8) out += "/" + d.slice(8, 12);
  if (d.length > 12) out += "-" + d.slice(12, 14);
  return out;
}

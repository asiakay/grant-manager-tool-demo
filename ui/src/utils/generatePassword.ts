const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*-_=+?.";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function randInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

export function generatePassword(length = 18): string {
  const required = [
    UPPER[randInt(UPPER.length)],
    LOWER[randInt(LOWER.length)],
    DIGITS[randInt(DIGITS.length)],
    SYMBOLS[randInt(SYMBOLS.length)],
  ];
  const rest = Array.from({ length: length - required.length }, () => ALL[randInt(ALL.length)]);
  const combined = [...required, ...rest];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined.join("");
}

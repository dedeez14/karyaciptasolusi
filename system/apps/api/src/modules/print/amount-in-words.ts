const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function en(n: number): string {
  if (n === 0) return 'zero';
  const chunk = (x: number) => {
    const parts: string[] = [];
    if (x >= 100) {
      parts.push(`${EN_ONES[Math.floor(x / 100)]} hundred`);
      x %= 100;
    }
    if (x >= 20) {
      parts.push(EN_TENS[Math.floor(x / 10)] + (x % 10 ? '-' + EN_ONES[x % 10] : ''));
    } else if (x > 0) parts.push(EN_ONES[x]);
    return parts.join(' ');
  };
  const out: string[] = [];
  let i = 0;
  while (n > 0) {
    const c = n % 1000;
    if (c) out.unshift(chunk(c) + (EN_SCALES[i] ? ' ' + EN_SCALES[i] : ''));
    n = Math.floor(n / 1000);
    i++;
  }
  return out.join(' ');
}

const ID_ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function id(n: number): string {
  if (n < 12) return ID_ONES[n];
  if (n < 20) return id(n - 10) + ' belas';
  if (n < 100) return id(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + id(n % 10) : '');
  if (n < 200) return 'seratus' + (n - 100 ? ' ' + id(n - 100) : '');
  if (n < 1000) return id(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + id(n % 100) : '');
  if (n < 2000) return 'seribu' + (n - 1000 ? ' ' + id(n - 1000) : '');
  if (n < 1e6) return id(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + id(n % 1000) : '');
  if (n < 1e9) return id(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + id(n % 1e6) : '');
  if (n < 1e12) return id(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + id(n % 1e9) : '');
  return id(Math.floor(n / 1e12)) + ' triliun' + (n % 1e12 ? ' ' + id(n % 1e12) : '');
}

const CURRENCY_WORDS: Record<string, { en: string; id: string }> = {
  IDR: { en: 'rupiah', id: 'rupiah' },
  USD: { en: 'US dollars', id: 'dolar AS' },
  SGD: { en: 'Singapore dollars', id: 'dolar Singapura' },
  EUR: { en: 'euros', id: 'euro' },
};

export function amountInWords(value: number, currency: string, lang: 'en' | 'id' = 'en'): string {
  const whole = Math.floor(Math.abs(value));
  const cents = Math.round((Math.abs(value) - whole) * 100);
  const cur = CURRENCY_WORDS[currency]?.[lang] ?? currency;
  let s = lang === 'id' ? (whole === 0 ? 'nol' : id(whole)) : en(whole);
  s += ' ' + cur;
  if (cents) s += lang === 'id' ? ` ${id(cents)} sen` : ` and ${en(cents)} cents`;
  s = s.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

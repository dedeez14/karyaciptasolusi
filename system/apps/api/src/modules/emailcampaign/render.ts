/**
 * HTML handling for marketing e-mails:
 * - an allow-list sanitizer (no dependencies) applied to every saved body
 * - merge tags ({{name}}, {{company}}, ...) with HTML escaping
 * - the compliance footer (sender, postal address, unsubscribe link) that every e-mail carries
 */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'p', 'br', 'hr', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'img', 'small', 'sup', 'sub', 'center', 'font', 'pre', 'code',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
/** tags dropped together with everything inside them */
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'form', 'textarea', 'select', 'button', 'head', 'title', 'frameset', 'frame', 'applet', 'audio', 'video', 'canvas', 'link', 'meta', 'base']);
const GLOBAL_ATTRS = new Set(['style', 'title', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'dir', 'face', 'size']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'name']),
  img: new Set(['src', 'alt']),
};
const MERGE_URL = /^\{\{\s*[a-z_]+\s*\}\}$/i;

const escapeAttr = (v: string) => v.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function decodeEntities(v: string) {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/&amp;/gi, '&');
}

/** only http(s) and mailto links / images; merge tags such as {{unsubscribe_url}} are allowed */
function safeUrl(value: string, kind: 'href' | 'src'): string | null {
  const v = value.trim();
  if (MERGE_URL.test(v)) return v;
  const probe = decodeEntities(v).replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
  if (probe.startsWith('https://') || probe.startsWith('http://')) return v;
  if (kind === 'href' && (probe.startsWith('mailto:') || probe.startsWith('tel:') || probe.startsWith('#'))) return v;
  return null;
}

function safeStyle(value: string): string | null {
  const probe = decodeEntities(value).replace(/\\/g, '').replace(/\/\*[\s\S]*?\*\//g, '').toLowerCase();
  if (/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|url\s*\(/.test(probe)) return null;
  return value.replace(/[<>]/g, '');
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/y;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Allow-list HTML sanitizer for e-mail bodies. Unknown tags are removed (their text kept), dangerous ones with content. */
export function sanitizeHtml(input: string): string {
  const src = input.replace(/\u0000/g, '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      out += src.slice(i).replace(/>/g, '&gt;');
      break;
    }
    out += src.slice(i, lt).replace(/>/g, '&gt;');
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    TAG_RE.lastIndex = lt;
    const m = TAG_RE.exec(src);
    if (!m) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    i = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (DROP_CONTENT.has(tag)) {
      if (!closing && m[4] !== '/') {
        const close = new RegExp(`</${tag}\\s*>`, 'ig');
        close.lastIndex = i;
        const cm = close.exec(src);
        i = cm ? close.lastIndex : src.length;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tag)) out += `</${tag}>`;
      continue;
    }
    const allowed = TAG_ATTRS[tag];
    const attrs: string[] = [];
    let hasTarget = false;
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR_RE.exec(m[3]))) {
      const name = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (name.startsWith('on') || !(GLOBAL_ATTRS.has(name) || allowed?.has(name))) continue;
      let v: string | null = value;
      if (name === 'href') v = safeUrl(value, 'href');
      else if (name === 'src') v = safeUrl(value, 'src');
      else if (name === 'style') v = safeStyle(value);
      else if (name === 'target') v = value === '_blank' ? '_blank' : null;
      if (v === null) continue;
      if (name === 'target') hasTarget = true;
      if (name === 'rel') continue; // set below
      attrs.push(`${name}="${escapeAttr(v)}"`);
    }
    if (tag === 'a' && hasTarget) attrs.push('rel="noopener noreferrer"');
    out += `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  }
  return out;
}

/** Plain-text alternative of an HTML body */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => `${t.replace(/<[^>]+>/g, '')} (${href})`)
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface MergeData {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  city?: string | null;
}

export const MERGE_TAGS = ['name', 'company', 'email', 'city', 'sender', 'unsubscribe_url'] as const;

/**
 * Merge values can end up inside href / src (a template may write href="{{name}}"): after merging, every
 * link and image URL is checked again and dropped unless it is http(s), mailto, tel or an anchor.
 */
export function scrubUrls(html: string): string {
  return html.replace(/\s(href|src)="([^"]*)"/gi, (whole, attr: string, value: string) => (safeUrl(value, attr.toLowerCase() === 'src' ? 'src' : 'href') !== null && !MERGE_URL.test(value.trim()) ? whole : ''));
}

/** Replaces {{tag}} placeholders. HTML mode escapes every value. Unknown tags are removed. */
export function merge(template: string, data: MergeData & { sender: string; unsubscribe_url: string }, html: boolean): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, raw: string) => {
    const key = raw.toLowerCase() as keyof typeof data;
    // name and company stand in for each other (Google Maps places have no contact name, pasted lists no company);
    // no English filler word, so Indonesian copy reads naturally
    const fallback = key === 'name' ? String(data.company ?? '') : key === 'company' ? String(data.name ?? '') : '';
    const v = String(data[key] ?? '').trim() || fallback;
    return html ? escapeHtml(v) : v;
  });
}

/** Best effort city from a free address ("Jl. ..., Kec. X, Kota Bandung, Jawa Barat 40115") */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const hit = parts.find((p) => /^(kota|kabupaten|kab\.)\s+/i.test(p));
  if (hit) return hit.replace(/^(kota|kabupaten|kab\.)\s+/i, '').trim();
  return parts.length >= 3 ? parts[parts.length - 2].replace(/\d{5}$/, '').trim() || null : null;
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

/**
 * Builds the final message for one recipient. The footer with sender, postal address and the
 * unsubscribe link is always appended and cannot be removed by the body.
 */
export function renderEmail(input: {
  subject: string;
  body: string;
  data: MergeData;
  sender: string;
  footerAddress: string;
  unsubscribeUrl: string;
  openPixelUrl?: string | null;
}): Rendered {
  const vars = { ...input.data, sender: input.sender, unsubscribe_url: input.unsubscribeUrl };
  const body = scrubUrls(merge(sanitizeHtml(input.body), vars, true));
  const subject = merge(input.subject, vars, false).replace(/[\r\n]+/g, ' ').trim();
  const address = input.footerAddress.trim();
  const footerHtml =
    `<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0 12px">` +
    `<p style="font-size:12px;line-height:1.5;color:#64748b;margin:0">${escapeHtml(input.sender)}` +
    (address ? `<br>${escapeHtml(address).replace(/\n/g, '<br>')}` : '') +
    `<br>You receive this e-mail because your contact details were listed for business enquiries. ` +
    `<a href="${escapeAttr(input.unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a> to stop receiving these e-mails.</p>`;
  const pixel = input.openPixelUrl ? `<img src="${escapeAttr(input.openPixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">` : '';
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#ffffff"><div style="max-width:640px;margin:0 auto;padding:24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1e293b">` +
    `${body}${footerHtml}</div>${pixel}</body></html>`;
  const text =
    `${htmlToText(body)}\n\n--\n${input.sender}` + (address ? `\n${address}` : '') + `\nUnsubscribe: ${input.unsubscribeUrl}`;
  return { subject, html, text };
}

/** RFC 5322-ish practical check used for audience cleaning */
export const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().replace(/^mailto:/i, '').toLowerCase();
  if (e.length > 200 || !EMAIL_RE.test(e)) return null;
  // reject obvious placeholders / image file names scraped from websites
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(e) || /^(example|test|sample)@/.test(e)) return null;
  return e;
}

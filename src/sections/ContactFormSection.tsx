import { useId, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Send, CheckCircle, MessageSquare, Phone, Mail, Clock, ChevronDown, Check, Loader2, AlertCircle, MessageCircle, RotateCcw,
} from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { BRAND } from '../lib/brand';
import { CMS_ENABLED, EMAIL_RE, ENQUIRY_LIMITS, submitEnquiry } from '../lib/site';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

type Field = 'nama' | 'email' | 'telepon' | 'subjek' | 'pesan';
type FormState = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const EMPTY: FormState = { nama: '', email: '', telepon: '', subjek: '', pesan: '' };

/* ─── input dengan label mengambang (label terhubung via htmlFor) ─── */
function FloatingInput({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  isTextarea = false,
  rows = 4,
  maxLength,
  autoComplete,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  isTextarea?: boolean;
  rows?: number;
  maxLength: number;
  autoComplete?: string;
  error?: string;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const [focused, setFocused] = useState(false);
  const hasValue = value.length > 0;
  const isActive = focused || hasValue;

  const sharedProps = {
    id,
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    required,
    maxLength,
    autoComplete,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errId : undefined,
    className: 'input-field pt-5 pb-2.5 px-4',
  };

  return (
    <div>
      <div className="relative">
        <motion.label
          htmlFor={id}
          animate={{
            y: isActive ? -11 : 0,
            scale: isActive ? 0.78 : 1,
            color: error ? '#B91C1C' : focused ? BRAND.navy : hasValue ? '#15803D' : '#64748B',
          }}
          transition={{ duration: 0.2, ease: easing }}
          className="absolute left-4 top-3.5 text-sm origin-left pointer-events-none z-10 font-medium"
        >
          {label}
          {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </motion.label>

        {isTextarea ? <textarea {...sharedProps} rows={rows} /> : <input type={type} {...sharedProps} />}

        <AnimatePresence>
          {hasValue && !focused && !error && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              className="absolute right-3 top-3.5"
              aria-hidden="true"
            >
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                <Check size={11} className="text-green-600" strokeWidth={3} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && (
        <p id={errId} className="mt-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─── select dengan label mengambang ─── */
function FloatingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const hasValue = value.length > 0;
  const isActive = focused || hasValue;

  return (
    <div className="relative">
      <motion.label
        htmlFor={id}
        animate={{
          y: isActive ? -11 : 0,
          scale: isActive ? 0.78 : 1,
          color: focused ? BRAND.navy : hasValue ? '#15803D' : '#64748B',
        }}
        transition={{ duration: 0.2, ease: easing }}
        className="absolute left-4 top-3.5 text-sm origin-left pointer-events-none z-10 font-medium"
      >
        {label}
      </motion.label>

      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="input-field pt-5 pb-2.5 px-4 pr-10 appearance-none cursor-pointer"
      >
        <option value="" disabled />
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className={`absolute right-3 top-4 pointer-events-none transition-colors duration-200 ${focused ? 'text-brand' : 'text-[#94A3B8]'}`}
      />
    </div>
  );
}

/* ─── partikel konfeti saat berhasil ─── */
function ConfettiBurst() {
  const colors = [BRAND.navy, BRAND.gold, BRAND.navyLight, BRAND.goldDark, BRAND.navyDark, '#22C55E'];
  const particles = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    angle: (360 / 16) * i,
    distance: 50 + (i % 4) * 18,
    size: 4 + (i % 3) * 2.5,
    color: colors[i % colors.length],
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-visible" aria-hidden="true">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={{
            x: Math.cos((p.angle * Math.PI) / 180) * p.distance,
            y: Math.sin((p.angle * Math.PI) / 180) * p.distance,
            scale: 0,
            opacity: 0,
          }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.15 }}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{ width: p.size, height: p.size, background: p.color, marginLeft: -p.size / 2, marginTop: -p.size / 2 }}
        />
      ))}
    </div>
  );
}

function validate(f: FormState): Errors {
  const e: Errors = {};
  const L = ENQUIRY_LIMITS;
  if (!f.nama.trim()) e.nama = 'Nama wajib diisi.';
  else if (f.nama.trim().length > L.name) e.nama = `Nama maksimal ${L.name} karakter.`;
  if (!f.email.trim()) e.email = 'Email wajib diisi.';
  else if (!EMAIL_RE.test(f.email.trim())) e.email = 'Format email belum benar, contoh: nama@domain.com';
  else if (f.email.trim().length > L.email) e.email = `Email maksimal ${L.email} karakter.`;
  if (f.telepon.trim().length > L.phone) e.telepon = `Telepon maksimal ${L.phone} karakter.`;
  else if (f.telepon.trim() && !/^[+\d][\d\s().-]{5,}$/.test(f.telepon.trim())) e.telepon = 'Nomor telepon hanya berisi angka, spasi, +, -, atau tanda kurung.';
  if (f.subjek.length > L.subject) e.subjek = `Subjek maksimal ${L.subject} karakter.`;
  if (!f.pesan.trim()) e.pesan = 'Pesan wajib diisi.';
  else if (f.pesan.trim().length > L.message) e.pesan = `Pesan maksimal ${L.message} karakter.`;
  return e;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; waText: string }
  | { kind: 'whatsapp'; waText: string; reason: 'no-server' | 'offline' }
  | { kind: 'error'; message: string; offerWa: boolean };

const SUBJECTS = ['Konsultasi', 'Pembuatan Aplikasi', 'Kerjasama', 'Saran', 'Lainnya'];

/* ─── komponen utama ─── */
export default function ContactFormSection() {
  const { site, waLink } = useSite();
  const { company } = site;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const buildWaText = (f: FormState) =>
    [
      `Halo, saya ${f.nama.trim()}`,
      `Email: ${f.email.trim()}`,
      f.telepon.trim() ? `Telepon: ${f.telepon.trim()}` : '',
      `Subjek: ${f.subjek || 'Umum'}`,
      '',
      f.pesan.trim(),
    ]
      .filter((l, i) => l !== '' || i === 4)
      .join('\n');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      const first = (Object.keys(errs) as Field[])[0];
      document.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] textarea`)?.focus();
      return;
    }
    const waText = buildWaText(form);

    // Tanpa server ERP: perilaku lama — teruskan ke WhatsApp (sinkron agar tidak diblok popup blocker)
    if (!CMS_ENABLED) {
      window.open(waLink(waText), '_blank', 'noopener,noreferrer');
      setStatus({ kind: 'whatsapp', waText, reason: 'no-server' });
      setForm(EMPTY);
      return;
    }

    setStatus({ kind: 'sending' });
    const res = await submitEnquiry({
      kind: 'contact',
      name: form.nama.trim(),
      email: form.email.trim(),
      phone: form.telepon.trim() || undefined,
      subject: form.subjek || undefined,
      message: form.pesan.trim(),
      website: honeypot,
    });

    if (res.ok) {
      setStatus({ kind: 'sent', waText });
      setForm(EMPTY);
      setErrors({});
      return;
    }
    if (res.reason === 'network') {
      // Server tak terjangkau: coba buka WhatsApp; bila popup diblok, tombol tetap tersedia.
      window.open(waLink(waText), '_blank', 'noopener,noreferrer');
      setStatus({ kind: 'whatsapp', waText, reason: 'offline' });
      return;
    }
    setStatus({ kind: 'error', message: res.message, offerWa: res.reason === 'server' });
  };

  const updateField = (field: Field) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const infoItems = [
    { icon: MessageSquare, title: 'Respon Cepat', desc: 'Tim kami akan membalas dalam 1x24 jam', gradient: 'from-brand to-brand-dark', href: undefined as string | undefined },
    { icon: Phone, title: 'WhatsApp Langsung', desc: `${company.phone} (Klik untuk chat)`, gradient: 'from-[#22C55E] to-[#15803D]', href: waLink() },
    { icon: Mail, title: 'Email', desc: company.email, gradient: 'from-brand-dark to-brand-light', href: `mailto:${company.email}` },
    { icon: Clock, title: 'Jam Operasional', desc: company.hours.join(' · '), gradient: 'from-gold to-gold-dark', href: undefined },
  ];

  const done = status.kind === 'sent' || status.kind === 'whatsapp';

  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden" aria-labelledby="kirim-pesan-title">
      {/* Decorative background blobs */}
      <div className="absolute top-20 right-0 w-96 h-96 rounded-full opacity-[0.04]" style={{ background: 'radial-gradient(circle, rgb(var(--brand)), transparent 70%)' }} />
      <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-[0.06]" style={{ background: 'radial-gradient(circle, rgb(var(--gold)), transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-14"
        >
          <span className="section-badge mb-3">Pesan &amp; Saran</span>
          <h2 id="kirim-pesan-title" className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Kirim <span className="text-accent">Pesan</span>
          </h2>
          <p className="text-[#475569] max-w-lg mx-auto text-sm leading-relaxed">
            {CMS_ENABLED
              ? 'Punya pertanyaan atau saran? Isi form di bawah — pesan Anda langsung masuk ke tim kami dan dibalas maksimal 1x24 jam.'
              : 'Punya pertanyaan atau saran? Isi form di bawah — pesan Anda langsung diteruskan ke WhatsApp tim kami.'}
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* ─── Form Card ─── */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: easing }}
            className="lg:col-span-3"
          >
            <div className="warm-card-static p-6 sm:p-8 lg:p-10 relative" style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)' }}>
              <div aria-live="polite">
                <AnimatePresence mode="wait">
                  {done ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.45, ease: easing }}
                      className="flex flex-col items-center justify-center py-12 text-center relative"
                    >
                      {status.kind === 'sent' && <ConfettiBurst />}
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-5 ${status.kind === 'sent' ? 'bg-green-50' : 'bg-brand-tint'}`}>
                        {status.kind === 'sent' ? (
                          <CheckCircle size={44} className="text-green-600" aria-hidden="true" />
                        ) : (
                          <MessageCircle size={40} className="text-brand" aria-hidden="true" />
                        )}
                      </div>

                      {status.kind === 'sent' ? (
                        <>
                          <h3 className="text-xl font-bold text-[#0F172A] mb-2">Pesan Anda sudah kami terima!</h3>
                          <p className="text-sm text-[#475569] max-w-md">
                            Terima kasih. Tim kami akan membalas melalui email atau telepon yang Anda cantumkan, maksimal 1x24 jam pada hari kerja.
                          </p>
                        </>
                      ) : (
                        <>
                          <h3 className="text-xl font-bold text-[#0F172A] mb-2">Lanjutkan di WhatsApp</h3>
                          <p className="text-sm text-[#475569] max-w-md">
                            {status.kind === 'whatsapp' && status.reason === 'offline'
                              ? 'Server kami sedang tidak dapat dihubungi, jadi pesan Anda kami siapkan di WhatsApp. '
                              : 'Pesan Anda sudah kami siapkan di WhatsApp. '}
                            Tekan tombol kirim di WhatsApp untuk menyelesaikan — kami balas maksimal 1x24 jam.
                          </p>
                        </>
                      )}

                      <div className="flex flex-col sm:flex-row gap-3 mt-7">
                        <a
                          href={waLink(status.waText)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={status.kind === 'sent' ? 'btn-secondary' : 'btn-gold'}
                        >
                          <MessageCircle size={16} aria-hidden="true" />
                          {status.kind === 'sent' ? 'Lanjutkan via WhatsApp' : 'Buka WhatsApp'}
                        </a>
                        <button type="button" onClick={() => setStatus({ kind: 'idle' })} className="btn-ghost">
                          <RotateCcw size={15} aria-hidden="true" />
                          Kirim pesan lain
                        </button>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.form
                      key="form"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onSubmit={handleSubmit}
                      noValidate
                      className="space-y-5 relative z-10"
                      aria-describedby={status.kind === 'error' ? 'kontak-form-error' : undefined}
                    >
                      {/* Honeypot anti-spam: manusia tidak melihat/mengisi kolom ini */}
                      <div aria-hidden="true" className="absolute -left-[10000px] top-auto w-px h-px overflow-hidden">
                        <label htmlFor="kontak-website">Website</label>
                        <input
                          id="kontak-website"
                          name="website"
                          type="text"
                          tabIndex={-1}
                          autoComplete="off"
                          value={honeypot}
                          onChange={(e) => setHoneypot(e.target.value)}
                        />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-5">
                        <div data-field="nama">
                          <FloatingInput label="Nama Lengkap" value={form.nama} onChange={updateField('nama')} required maxLength={ENQUIRY_LIMITS.name} autoComplete="name" error={errors.nama} />
                        </div>
                        <div data-field="email">
                          <FloatingInput label="Email" type="email" value={form.email} onChange={updateField('email')} required maxLength={ENQUIRY_LIMITS.email} autoComplete="email" error={errors.email} />
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-5">
                        <div data-field="telepon">
                          <FloatingInput label="Telepon / WhatsApp" type="tel" value={form.telepon} onChange={updateField('telepon')} maxLength={ENQUIRY_LIMITS.phone} autoComplete="tel" error={errors.telepon} />
                        </div>
                        <FloatingSelect label="Subjek" value={form.subjek} onChange={updateField('subjek')} options={SUBJECTS} />
                      </div>

                      <div data-field="pesan">
                        <FloatingInput label="Pesan" value={form.pesan} onChange={updateField('pesan')} required isTextarea rows={5} maxLength={ENQUIRY_LIMITS.message} error={errors.pesan} />
                        <p className="mt-1 text-right text-[11px] text-[#64748B]" aria-hidden="true">
                          {form.pesan.length}/{ENQUIRY_LIMITS.message}
                        </p>
                      </div>

                      {status.kind === 'error' && (
                        <div id="kontak-form-error" role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <div className="flex-1">
                            <p>{status.message}</p>
                            {status.offerWa && (
                              <a href={waLink(buildWaText(form))} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 font-bold text-brand underline decoration-gold decoration-2 underline-offset-4">
                                <MessageCircle size={15} aria-hidden="true" /> Kirim via WhatsApp saja
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      <motion.button
                        type="submit"
                        disabled={status.kind === 'sending'}
                        whileHover={status.kind !== 'sending' ? { y: -2 } : {}}
                        whileTap={status.kind !== 'sending' ? { y: 0 } : {}}
                        className="btn-primary w-full justify-center mt-2 disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {status.kind === 'sending' ? (
                          <span className="flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                            Mengirim...
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Send size={16} aria-hidden="true" />
                            {CMS_ENABLED ? 'Kirim Pesan' : 'Kirim via WhatsApp'}
                          </span>
                        )}
                      </motion.button>
                      <p className="text-[11px] text-[#64748B] text-center">
                        Data Anda hanya dipakai untuk membalas pesan ini. Lihat{' '}
                        <Link to="/kebijakan-privasi" className="underline hover:text-brand">Kebijakan Privasi</Link>.
                      </p>
                    </motion.form>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>

          {/* ─── Info Cards ─── */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2, ease: easing }}
            className="lg:col-span-2 space-y-4"
          >
            {infoItems.map((item, i) => {
              const content = (
                <>
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${item.gradient} flex items-center justify-center flex-shrink-0 shadow-md`}>
                    <item.icon size={20} className={item.gradient.includes('gold') ? 'text-gold-ink' : 'text-white'} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#0F172A] mb-0.5 group-hover:text-brand transition-colors duration-200">{item.title}</p>
                    <p className="text-xs text-[#475569] leading-relaxed break-words">{item.desc}</p>
                  </div>
                </>
              );
              return (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.3 + i * 0.1, ease: easing }}
                >
                  {item.href ? (
                    <a
                      href={item.href}
                      target={item.href.startsWith('http') ? '_blank' : undefined}
                      rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                      className="warm-card flex items-start gap-4 p-5 group"
                    >
                      {content}
                    </a>
                  ) : (
                    <div className="warm-card flex items-start gap-4 p-5 cursor-default group">{content}</div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

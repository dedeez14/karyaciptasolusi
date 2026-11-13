import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, CheckCircle, Bell, Loader2, AlertCircle } from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { Link } from 'react-router-dom';
import { CMS_ENABLED, EMAIL_RE, ENQUIRY_LIMITS, NEWSLETTER_NOTICE, submitEnquiry } from '../lib/site';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; via: 'server' | 'whatsapp' }
  | { kind: 'error'; message: string };

export default function NewsletterSection() {
  const { waLink } = useSite();
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const openWhatsApp = (addr: string) => {
    const waText = `Halo, saya ingin berlangganan update & tips dari PT Karya Cipta Solusi.\nEmail saya: ${addr}`;
    window.open(waLink(waText), '_blank', 'noopener,noreferrer');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    const addr = email.trim();
    if (!EMAIL_RE.test(addr) || addr.length > ENQUIRY_LIMITS.email) {
      setStatus({ kind: 'error', message: 'Masukkan alamat email yang valid, contoh: nama@domain.com' });
      return;
    }

    // Tanpa server ERP: perilaku lama — teruskan lewat WhatsApp (sinkron agar tidak diblok popup blocker)
    if (!CMS_ENABLED) {
      openWhatsApp(addr);
      setStatus({ kind: 'done', via: 'whatsapp' });
      setEmail('');
      return;
    }

    setStatus({ kind: 'sending' });
    const res = await submitEnquiry({
      kind: 'newsletter',
      name: (addr.split('@')[0] || addr).slice(0, ENQUIRY_LIMITS.name),
      email: addr,
      website: honeypot,
      consentText: NEWSLETTER_NOTICE,
    });
    if (res.ok) {
      setStatus({ kind: 'done', via: 'server' });
      setEmail('');
    } else if (res.reason === 'network') {
      openWhatsApp(addr);
      setStatus({ kind: 'done', via: 'whatsapp' });
      setEmail('');
    } else {
      setStatus({ kind: 'error', message: res.message });
    }
  };

  return (
    <section className="on-dark relative py-20 lg:py-24 overflow-hidden" aria-labelledby="newsletter-title">
      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgb(var(--brand-darker)) 0%, rgb(var(--brand)) 55%, rgb(var(--brand-dark)) 100%)' }} />
      <div className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
        backgroundSize: '30px 30px'
      }} />
      <div aria-hidden="true" className="absolute -top-24 right-[8%] w-72 h-72 rounded-full" style={{ background: 'radial-gradient(circle, rgb(var(--gold) / 0.18), transparent 70%)' }} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }}>
          <Bell size={40} className="text-gold mx-auto mb-4" aria-hidden="true" />
          <h2 id="newsletter-title" className="text-3xl lg:text-4xl font-bold text-white mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Tetap Terupdate
          </h2>
          <p className="text-white/85 text-sm mb-8 max-w-lg mx-auto">
            Berlangganan newsletter kami untuk mendapatkan tips teknologi, promo spesial, dan update terbaru langsung di inbox Anda.
          </p>

          <div aria-live="polite">
            {status.kind === 'done' ? (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center justify-center gap-2 text-white">
                <CheckCircle size={20} className="text-gold flex-shrink-0" aria-hidden="true" />
                <span className="font-semibold">
                  {status.via === 'server'
                    ? 'Terima kasih! Email Anda sudah terdaftar untuk menerima update dari kami.'
                    : 'Terima kasih! Selesaikan pendaftaran lewat pesan WhatsApp yang terbuka.'}
                </span>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} noValidate className="max-w-md mx-auto">
                {/* Honeypot anti-spam */}
                <div aria-hidden="true" className="absolute -left-[10000px] top-auto w-px h-px overflow-hidden">
                  <label htmlFor="newsletter-website">Website</label>
                  <input
                    id="newsletter-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label htmlFor="newsletter-email" className="sr-only">Alamat email</label>
                  <input
                    id="newsletter-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status.kind === 'error') setStatus({ kind: 'idle' });
                    }}
                    placeholder="emailanda@gmail.com"
                    autoComplete="email"
                    maxLength={ENQUIRY_LIMITS.email}
                    required
                    aria-invalid={status.kind === 'error' ? true : undefined}
                    aria-describedby={status.kind === 'error' ? 'newsletter-error' : undefined}
                    className="input-white"
                  />
                  <button type="submit" disabled={status.kind === 'sending'} className="btn-gold flex-shrink-0 disabled:opacity-70 disabled:cursor-not-allowed">
                    {status.kind === 'sending' ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
                    {status.kind === 'sending' ? 'Mendaftar...' : 'Subscribe'}
                  </button>
                </div>
                {status.kind === 'error' && (
                  <p id="newsletter-error" role="alert" className="mt-3 flex items-center justify-center gap-1.5 text-sm font-medium text-gold">
                    <AlertCircle size={15} aria-hidden="true" /> {status.message}
                  </p>
                )}
              </form>
            )}
          </div>

          <p className="text-white/70 text-[11px] mt-4">
            {NEWSLETTER_NOTICE} Lihat{' '}
            <Link to="/kebijakan-privasi" className="underline hover:text-white">
              Kebijakan Privasi
            </Link>
            .
          </p>
        </motion.div>
      </div>
    </section>
  );
}

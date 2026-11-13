import { motion } from 'framer-motion';
import { BadgeCheck, ArrowRight } from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { iconFor } from '../lib/icons';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

export default function WhyUsSection() {
  const { site, waLink } = useSite();
  const reasons = site.reasons;
  return (
    <section id="kenapa-kami" className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, rgb(var(--brand) / 0.03), transparent 70%)' }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-14">
          <span className="section-badge mb-3">Kenapa Kami</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Alasan Klien <span className="text-accent">Mempercayai</span> Kami
          </h2>
          <p className="text-[#475569] max-w-xl mx-auto text-sm leading-relaxed">
            Kami tahu memilih partner teknologi itu keputusan besar. Karena itu kami pastikan risiko Anda sekecil mungkin.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {reasons.map((r, i) => {
            const Icon = iconFor(r.icon, BadgeCheck);
            return (
            <motion.div key={`${i}-${r.title}`} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: easing }}
              className="warm-card p-6 flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, rgb(var(--brand-tint)), rgb(var(--brand-tint-strong)))' }}>
                <Icon size={21} className="text-brand" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[#0F172A] mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{r.title}</h3>
                <p className="text-[#475569] text-[13px] leading-relaxed">{r.desc}</p>
              </div>
            </motion.div>
            );
          })}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2, ease: easing }}
          className="on-dark relative overflow-hidden rounded-2xl p-8 lg:p-10 flex flex-col lg:flex-row items-center justify-between gap-6"
          style={{ background: 'linear-gradient(135deg, rgb(var(--brand-darker)), rgb(var(--brand)))' }}>
          <div aria-hidden="true" className="absolute -top-16 -right-16 w-48 h-48 rounded-full" style={{ background: 'radial-gradient(circle, rgb(var(--gold) / 0.22), transparent 70%)' }} />
          <div className="relative text-center lg:text-left">
            <h3 className="text-white font-bold text-xl lg:text-2xl mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Masih ragu? Mulai dari konsultasi gratis saja.
            </h3>
            <p className="text-white/80 text-sm">Tanpa biaya, tanpa komitmen — Anda hanya lanjut jika penawarannya cocok.</p>
          </div>
          <a href={waLink('Halo, saya ingin konsultasi gratis terlebih dahulu')}
            target="_blank" rel="noopener noreferrer"
            className="btn-gold relative flex-shrink-0 group">
            Chat WhatsApp Sekarang
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

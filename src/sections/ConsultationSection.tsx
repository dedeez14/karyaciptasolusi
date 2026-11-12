import { motion } from 'framer-motion';
import { Rocket, ArrowRight, Phone } from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { iconFor } from '../lib/icons';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const stepIconBg = [
  'linear-gradient(135deg, rgb(var(--brand)), rgb(var(--brand-dark)))',
  'linear-gradient(135deg, rgb(var(--brand-dark)), rgb(var(--brand-light)))',
  'linear-gradient(135deg, rgb(var(--brand-light)), rgb(var(--brand)))',
];

export default function ConsultationSection() {
  const { site, waLink, telLink } = useSite();
  const steps = site.steps;
  return (
    <section id="konsultasi" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 50%, rgb(var(--brand-tint)) 100%)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-14">
          <span className="section-badge mb-3">Cara Kerja Sama</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Harga Menyesuaikan <span className="text-accent">Kebutuhan</span> Anda
          </h2>
          <p className="text-[#475569] max-w-xl mx-auto text-sm leading-relaxed">
            Setiap bisnis punya kebutuhan yang berbeda, karena itu kami tidak memakai paket harga tetap.
            Konsultasikan proyek Anda terlebih dahulu — penawaran kami susun dari hasil diskusi bersama.
          </p>
        </motion.div>

        <div className={`grid gap-6 mb-14 ${steps.length % 3 === 0 ? 'md:grid-cols-3' : steps.length === 4 ? 'md:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-2'}`}>
          {steps.map((s, i) => {
            const Icon = iconFor(s.icon, Rocket);
            const step = String(i + 1).padStart(2, '0');
            return (
            <motion.div key={`${i}-${s.title}`} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: easing }}
              className="warm-card relative p-7">
              <span className="absolute top-5 right-6 text-5xl font-bold text-brand/[0.07] select-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {step}
              </span>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: stepIconBg[i % stepIconBg.length] }}>
                <Icon size={22} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-[#0F172A] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{s.title}</h3>
              <p className="text-[#475569] text-sm leading-relaxed">{s.desc}</p>
            </motion.div>
            );
          })}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2, ease: easing }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href={waLink('Halo, saya ingin konsultasi kebutuhan teknologi bisnis saya')} target="_blank" rel="noopener noreferrer" className="btn-primary group">
            Mulai Konsultasi Gratis
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </a>
          <a href={telLink()} className="btn-secondary">
            <Phone size={15} />
            {site.company.phone}
          </a>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.35 }}
          className="text-center text-xs text-[#475569]/70 mt-5">
          Konsultasi 100% gratis &amp; tanpa komitmen — Anda hanya membayar jika sepakat melanjutkan.
        </motion.p>
      </div>
    </section>
  );
}

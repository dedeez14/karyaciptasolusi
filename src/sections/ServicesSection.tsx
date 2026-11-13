import { motion } from 'framer-motion';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { iconFor } from '../lib/icons';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Tata letak grid 6 kolom (lg) untuk n kartu: baris berisi 3 (span-2) lalu sisa 2 (span-3). */
function spanFor(i: number, n: number): string {
  const rem = n % 3;
  const tailStart = rem === 0 ? n : rem === 2 ? n - 2 : Math.max(0, n - 4);
  if (n === 1) return 'lg:col-span-6';
  return i >= tailStart ? 'lg:col-span-3' : 'lg:col-span-2';
}

export default function ServicesSection() {
  const { site, waLink } = useSite();
  const services = site.services;
  return (
    <section id="layanan" className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute top-0 left-0 w-72 h-72 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, rgb(var(--brand) / 0.02), transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="mb-14">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="section-badge mb-3">Layanan Kami</span>
              <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Solusi <span className="text-accent">Terintegrasi</span>
              </h2>
            </div>
            <p className="text-[#475569] max-w-md text-sm leading-relaxed">
              Pilar layanan utama yang saling terhubung untuk memenuhi kebutuhan teknologi bisnis Anda secara menyeluruh.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-5">
          {services.map((svc, i) => {
            const Icon = iconFor(svc.icon, Sparkles);
            const href = svc.link ?? waLink(`Halo, saya ingin konsultasi tentang layanan ${svc.title}`);
            const external = !(href.startsWith('/') || href.startsWith('#'));
            return (
            <motion.div key={`${i}-${svc.title}`} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: easing }}
              className={spanFor(i, services.length)}>
              <a
                href={href}
                target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}
                className="group relative flex flex-col h-full bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden transition-all duration-300 hover:border-brand/40 hover:shadow-xl hover:shadow-brand/10 hover:-translate-y-1"
              >
                {/* Gambar dengan overlay duotone navy agar serasi dengan tema */}
                <div className="relative h-44 overflow-hidden flex-shrink-0 bg-gradient-to-br from-brand-tint to-brand-tint-strong">
                  {svc.image && (
                    <img src={svc.image} alt={svc.title} loading="lazy" decoding="async"
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgb(var(--brand-dark) / 0.15) 0%, rgba(15,23,42,0.05) 55%, rgba(255,255,255,0.9) 100%)' }} />

                  {/* Nomor */}
                  <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm text-brand text-xs font-bold shadow-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                {/* Konten di panel putih - kontras penuh */}
                <div className="relative flex flex-col flex-1 px-6 pt-10 pb-6">
                  {/* Ikon mengambang di batas gambar-konten */}
                  <div className="absolute -top-6 left-6 w-12 h-12 rounded-xl flex items-center justify-center shadow-lg shadow-brand/25 group-hover:scale-110 transition-transform duration-300"
                    style={{ background: 'linear-gradient(135deg, rgb(var(--brand)), rgb(var(--brand-dark)))' }}>
                    <Icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-[#0F172A] font-bold text-lg lg:text-xl mb-2 group-hover:text-brand transition-colors" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {svc.title}
                  </h3>
                  <p className="text-[#475569] text-sm leading-relaxed mb-5">{svc.desc}</p>
                  <span className="mt-auto inline-flex items-center gap-1.5 text-brand text-xs font-bold">
                    {svc.link ? 'Selengkapnya' : 'Konsultasikan Layanan Ini'}
                    <span className="inline-block h-0.5 w-0 bg-gold group-hover:w-4 transition-all duration-300" aria-hidden="true" />
                    <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-300" />
                  </span>
                </div>
              </a>
            </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

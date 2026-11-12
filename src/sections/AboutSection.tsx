import { motion } from 'framer-motion';
import { ArrowUpRight, ExternalLink, LayoutDashboard } from 'lucide-react';
import { useSite } from '../lib/siteContext';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

/*
 * Bagian "Tentang Kami" diganti menjadi Portofolio (keputusan 2026-09-19): karya nyata yang
 * kami bangun dan jalankan sendiri, tiap kartu menuju aplikasi yang hidup. Portofolio lengkap
 * (pengalaman, stack, proyek klien) ada di dedeproject.dev.
 */
const PORTOFOLIO_LENGKAP = 'https://dedeproject.dev/#projects';

export default function AboutSection() {
  const { site } = useSite();
  const karya = site.portfolio;
  return (
    <section id="portofolio" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 50%, #F8FAFC 100%)' }}>
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, rgb(var(--brand) / 0.03), transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-6">
          <span className="section-badge mb-3">Portofolio</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Karya yang <span className="text-accent">Kami Jalankan</span></h2>
        </motion.div>
        <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1, ease: easing }}
          className="text-[#475569] text-sm leading-relaxed text-center max-w-2xl mx-auto mb-12">
          Bukan sekadar tangkapan layar: setiap aplikasi di bawah ini kami bangun sendiri dan berjalan di server kami. Silakan buka dan coba langsung.
        </motion.p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {karya.map((k, i) => {
            const body = (
              <>
                <div className="relative aspect-[16/9] bg-gradient-to-br from-brand-tint to-brand-tint-strong overflow-hidden">
                  {/* placeholder netral bila tidak ada gambar / gambar gagal dimuat */}
                  <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                    <LayoutDashboard size={40} className="text-brand/25" />
                  </div>
                  {k.image && (
                    <img src={k.image} alt={`Tampilan ${k.title}`} loading="lazy" decoding="async" width={640} height={360}
                      className="relative w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  {k.category && (
                    <span className="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/90 text-brand border border-brand-tint-strong">{k.category}</span>
                  )}
                </div>
                <div className="p-5 flex flex-col flex-1">
                  <h3 className="text-base font-bold text-[#0F172A] mb-1.5 flex items-start justify-between gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    <span>{k.title}</span>
                    {k.url && <ExternalLink size={15} className="shrink-0 mt-1 text-[#94A3B8] group-hover:text-brand transition-colors" />}
                  </h3>
                  <p className="text-[#475569] text-sm leading-relaxed flex-1">{k.summary}</p>
                  {k.tech.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5 mt-4" aria-label="Teknologi">
                      {k.tech.map((t) => (
                        <li key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155]">{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            );
            const motionProps = {
              initial: { opacity: 0, y: 30 },
              whileInView: { opacity: 1, y: 0 },
              viewport: { once: true },
              transition: { duration: 0.5, delay: Math.min(i, 8) * 0.08, ease: easing },
            };
            return k.url ? (
              <motion.a key={`${i}-${k.title}`} href={k.url} target={k.url.startsWith('/') || k.url.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer"
                {...motionProps}
                className="warm-card group flex flex-col overflow-hidden hover:no-underline" aria-label={`Buka ${k.title}`}>
                {body}
              </motion.a>
            ) : (
              <motion.div key={`${i}-${k.title}`} {...motionProps} className="warm-card group flex flex-col overflow-hidden">
                {body}
              </motion.div>
            );
          })}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, ease: easing }} className="text-center">
          <a href={PORTOFOLIO_LENGKAP} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center gap-2 hover:no-underline">
            Lihat portofolio lengkap di dedeproject.dev <ArrowUpRight size={16} />
          </a>
          <p className="text-[#94A3B8] text-xs mt-3">Pengalaman, teknologi, dan proyek klien lainnya.</p>
        </motion.div>
      </div>
    </section>
  );
}

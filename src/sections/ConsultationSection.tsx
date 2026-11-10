import { motion } from 'framer-motion';
import { MessagesSquare, FileText, Rocket, ArrowRight, Phone } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const steps = [
  {
    icon: MessagesSquare,
    step: '01',
    title: 'Konsultasi Gratis',
    desc: 'Ceritakan kebutuhan dan tujuan bisnis Anda. Kami bantu petakan solusi teknologi yang paling tepat, tanpa biaya.',
    iconBg: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
  },
  {
    icon: FileText,
    step: '02',
    title: 'Penawaran Custom',
    desc: 'Dari hasil diskusi, kami susun penawaran dengan lingkup kerja dan harga yang menyesuaikan kebutuhan serta anggaran Anda.',
    iconBg: 'linear-gradient(135deg, #0F4C81, #1E6BAF)',
  },
  {
    icon: Rocket,
    step: '03',
    title: 'Pengerjaan & Support',
    desc: 'Setelah sepakat, tim kami mulai bekerja dengan progres transparan hingga solusi berjalan dan tetap kami dampingi.',
    iconBg: 'linear-gradient(135deg, #1D4ED8, #2563EB)',
  },
];

export default function ConsultationSection() {
  return (
    <section id="konsultasi" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 50%, #EFF6FF 100%)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-14">
          <span className="section-badge mb-3">Cara Kerja Sama</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Harga Menyesuaikan <span style={{ color: '#1D4ED8' }}>Kebutuhan</span> Anda
          </h2>
          <p className="text-[#475569] max-w-xl mx-auto text-sm leading-relaxed">
            Setiap bisnis punya kebutuhan yang berbeda, karena itu kami tidak memakai paket harga tetap.
            Konsultasikan proyek Anda terlebih dahulu — penawaran kami susun dari hasil diskusi bersama.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6 mb-14">
          {steps.map((s, i) => (
            <motion.div key={s.step} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: easing }}
              className="warm-card relative p-7">
              <span className="absolute top-5 right-6 text-5xl font-bold text-[#2563EB]/[0.07] select-none" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {s.step}
              </span>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: s.iconBg }}>
                <s.icon size={22} className="text-white" />
              </div>
              <h3 className="text-lg font-bold text-[#0F172A] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{s.title}</h3>
              <p className="text-[#475569] text-sm leading-relaxed">{s.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2, ease: easing }}
          className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <a href="https://wa.me/6283898911244?text=Halo,%20saya%20ingin%20konsultasi%20kebutuhan%20teknologi%20bisnis%20saya" target="_blank" rel="noopener noreferrer" className="btn-primary group">
            Mulai Konsultasi Gratis
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </a>
          <a href="tel:083898911244" className="btn-secondary">
            <Phone size={15} />
            0838-9891-1244
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

import { motion } from 'framer-motion';
import { ShieldCheck, BadgeCheck, Wallet, FileCode2, MessageCircle, Eye, ArrowRight } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const reasons = [
  {
    icon: BadgeCheck,
    title: 'Badan Usaha Resmi (PT)',
    desc: 'Terdaftar resmi sebagai Perseroan Terbatas — kerja sama Anda dilindungi kontrak yang jelas dan legal.',
  },
  {
    icon: Wallet,
    title: 'Bayar Bertahap, Bukan di Muka',
    desc: 'DP 30%, 40% saat demo/MVP, sisanya setelah selesai. Anda tidak pernah membayar penuh sebelum melihat hasil.',
  },
  {
    icon: ShieldCheck,
    title: 'Garansi Bug Fixing 1 Bulan',
    desc: 'Setelah aplikasi live, bug yang muncul kami perbaiki gratis selama 1 bulan penuh — tanpa biaya tambahan.',
  },
  {
    icon: FileCode2,
    title: 'Source Code Milik Anda',
    desc: 'Setelah pelunasan, seluruh source code dan dokumentasi diserahkan. Anda tidak terkunci pada kami.',
  },
  {
    icon: MessageCircle,
    title: 'Respon Maksimal 1x24 Jam',
    desc: 'Komunikasi langsung via WhatsApp dengan tim yang mengerjakan proyek Anda — bukan bot atau call center.',
  },
  {
    icon: Eye,
    title: 'Progres Transparan',
    desc: 'Anda melihat demo/MVP di tengah pengerjaan dan menerima update progres rutin sampai proyek selesai.',
  },
];

export default function WhyUsSection() {
  return (
    <section id="kenapa-kami" className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute top-0 left-0 w-96 h-96 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #2563EB08, transparent 70%)' }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-14">
          <span className="section-badge mb-3">Kenapa Kami</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Alasan Klien <span style={{ color: '#1D4ED8' }}>Mempercayai</span> Kami
          </h2>
          <p className="text-[#475569] max-w-xl mx-auto text-sm leading-relaxed">
            Kami tahu memilih partner teknologi itu keputusan besar. Karena itu kami pastikan risiko Anda sekecil mungkin.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {reasons.map((r, i) => (
            <motion.div key={r.title} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: easing }}
              className="warm-card p-6 flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, #EFF6FF, #DBEAFE)' }}>
                <r.icon size={21} className="text-[#1D4ED8]" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[#0F172A] mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{r.title}</h3>
                <p className="text-[#475569] text-[13px] leading-relaxed">{r.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2, ease: easing }}
          className="rounded-2xl p-8 lg:p-10 flex flex-col lg:flex-row items-center justify-between gap-6"
          style={{ background: 'linear-gradient(135deg, #0F4C81, #1D4ED8)' }}>
          <div className="text-center lg:text-left">
            <h3 className="text-white font-bold text-xl lg:text-2xl mb-1.5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Masih ragu? Mulai dari konsultasi gratis saja.
            </h3>
            <p className="text-white/70 text-sm">Tanpa biaya, tanpa komitmen — Anda hanya lanjut jika penawarannya cocok.</p>
          </div>
          <a href="https://wa.me/6283898911244?text=Halo,%20saya%20ingin%20konsultasi%20gratis%20terlebih%20dahulu"
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-white text-[#1D4ED8] hover:bg-[#EFF6FF] transition-colors flex-shrink-0 group">
            Chat WhatsApp Sekarang
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </a>
        </motion.div>
      </div>
    </section>
  );
}

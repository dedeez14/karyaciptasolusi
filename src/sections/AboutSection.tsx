import { motion } from 'framer-motion';
import { ArrowUpRight, ExternalLink } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

/*
 * Bagian "Tentang Kami" diganti menjadi Portofolio (keputusan 2026-09-19): karya nyata yang
 * kami bangun dan jalankan sendiri, tiap kartu menuju aplikasi yang hidup. Portofolio lengkap
 * (pengalaman, stack, proyek klien) ada di dedeproject.dev.
 */
const PORTOFOLIO_LENGKAP = 'https://dedeproject.dev/#projects';

type Karya = {
  slug: string;
  nama: string;
  ringkas: string;
  url: string;
  kategori: string;
  teknologi: string[];
};

const karya: Karya[] = [
  {
    slug: 'movera',
    nama: 'MOVERA ERP',
    ringkas: 'ERP multi-perusahaan: pembelian, penjualan, persediaan, akuntansi, HRD, POS, dan modul proyek.',
    url: 'https://erp.karyaciptasolusi.com/',
    kategori: 'ERP',
    teknologi: ['Laravel 12', 'MySQL', 'Multi-tenant'],
  },
  {
    slug: 'bengkel',
    nama: 'Bengkel ERP',
    ringkas: 'Job-shop bengkel bubut: customer → gambar → SPK shop-floor realtime → QC, plus situs perusahaan.',
    url: 'https://bengkel.karyaciptasolusi.com/',
    kategori: 'ERP',
    teknologi: ['Go', 'React', 'PostgreSQL'],
  },
  {
    slug: 'bumdes',
    nama: 'SIBUMDes',
    ringkas: 'Sistem informasi BUM Desa: tata kelola, permodalan, unit usaha, pembukuan, pelaporan, dan portal desa.',
    url: 'https://bumdes.karyaciptasolusi.com/',
    kategori: 'Pemerintahan',
    teknologi: ['Go', 'React', 'PostgreSQL'],
  },
  {
    slug: 'ksp',
    nama: 'SISKOMEPU — Koperasi Simpan Pinjam',
    ringkas: 'Keanggotaan, simpanan, siklus pinjaman, akuntansi & SHU, dan portal anggota.',
    url: 'https://ksp.karyaciptasolusi.com/',
    kategori: 'Keuangan',
    teknologi: ['Go', 'React', 'MySQL'],
  },
  {
    slug: 'monitoring',
    nama: 'FleetCtl — Monitoring VPS',
    ringkas: 'Kelola banyak VPS sebagai satu fleet: metrik realtime, akses, firewall, cron, dan audit.',
    url: 'https://monitoring.karyaciptasolusi.com/',
    kategori: 'DevOps',
    teknologi: ['Go', 'Next.js', 'TimescaleDB'],
  },
];

export default function AboutSection() {
  return (
    <section id="portofolio" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 50%, #F8FAFC 100%)' }}>
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #2563EB08, transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-6">
          <span className="section-badge mb-3">Portofolio</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Karya yang <span style={{ color: '#1D4ED8' }}>Kami Jalankan</span></h2>
        </motion.div>
        <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.1, ease: easing }}
          className="text-[#475569] text-sm leading-relaxed text-center max-w-2xl mx-auto mb-12">
          Bukan sekadar tangkapan layar: setiap aplikasi di bawah ini kami bangun sendiri dan berjalan di server kami. Silakan buka dan coba langsung.
        </motion.p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {karya.map((k, i) => (
            <motion.a key={k.slug} href={k.url} target="_blank" rel="noopener noreferrer"
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: easing }}
              className="warm-card group flex flex-col overflow-hidden hover:no-underline" aria-label={`Buka ${k.nama}`}>
              <div className="relative aspect-[16/9] bg-[#EFF6FF] overflow-hidden">
                <img src={`/images/portofolio/${k.slug}.png`} alt={`Tampilan ${k.nama}`} loading="lazy" decoding="async" width={640} height={360}
                  className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <span className="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-white/90 text-[#1D4ED8] border border-[#DBEAFE]">{k.kategori}</span>
              </div>
              <div className="p-5 flex flex-col flex-1">
                <h3 className="text-base font-bold text-[#0F172A] mb-1.5 flex items-start justify-between gap-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  <span>{k.nama}</span>
                  <ExternalLink size={15} className="shrink-0 mt-1 text-[#94A3B8] group-hover:text-[#1D4ED8] transition-colors" />
                </h3>
                <p className="text-[#475569] text-sm leading-relaxed flex-1">{k.ringkas}</p>
                <ul className="flex flex-wrap gap-1.5 mt-4" aria-label="Teknologi">
                  {k.teknologi.map((t) => (
                    <li key={t} className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-[#F1F5F9] text-[#334155]">{t}</li>
                  ))}
                </ul>
              </div>
            </motion.a>
          ))}
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

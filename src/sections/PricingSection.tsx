import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Zap, Building2, Rocket } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const paketBulanan = [
  {
    nama: 'Starter', harga: 1500000, satuan: '/bulan',
    deskripsi: 'Cocok untuk UMKM yang baru mulai digitalisasi',
    fitur: ['1 Aplikasi Web/Mobile', 'Maintenance & Bug Fix', 'Support via WhatsApp', 'Report Bulanan', 'Garansi 1 Bulan'],
    highlight: false, icon: Zap,
  },
  {
    nama: 'Business', harga: 3500000, satuan: '/bulan',
    deskripsi: 'Solusi lengkap untuk bisnis yang berkembang',
    fitur: ['Aplikasi Web + Mobile', 'Maintenance Prioritas', 'Support 24/7', 'Report Mingguan', 'Garansi 3 Bulan', 'Konsultasi IT Bulanan', 'Backup Data Otomatis'],
    highlight: true, icon: Building2,
  },
  {
    nama: 'Enterprise', harga: 8000000, satuan: '/bulan',
    deskripsi: 'Untuk korporasi dengan kebutuhan kompleks',
    fitur: ['Unlimited Aplikasi', 'Dedicated Developer', 'Support 24/7 Prioritas', 'Report Real-time', 'Garansi 6 Bulan', 'Konsultasi IT Unlimited', 'Backup & Recovery', 'On-site Support'],
    highlight: false, icon: Rocket,
  },
];

const paketProyek = [
  {
    nama: 'Web Landing Page', harga: 2500000, satuan: '/proyek',
    deskripsi: 'Website company profile dengan desain profesional',
    fitur: ['Desain Custom', 'Responsive Mobile', 'SEO Friendly', 'Form Kontak', 'Revisi 2x', 'Training Penggunaan'],
    highlight: false, icon: Zap,
  },
  {
    nama: 'Aplikasi Custom', harga: 15000000, satuan: '/proyek',
    deskripsi: 'Aplikasi web/mobile sesuai kebutuhan bisnis Anda',
    fitur: ['Analisis Kebutuhan', 'UI/UX Design', 'Full Development', 'Testing & QA', 'Revisi 3x', 'Dokumentasi', 'Training & Deploy', 'Garansi 3 Bulan'],
    highlight: true, icon: Building2,
  },
  {
    nama: 'Sistem ERP', harga: 50000000, satuan: '/proyek',
    deskripsi: 'Sistem enterprise resource planning lengkap',
    fitur: ['Analisis Bisnis', 'Modul Lengkap', 'Multi User/Role', 'Laporan Keuangan', 'Revisi 5x', 'Integrasi API', 'Training Tim', 'Garansi 6 Bulan', 'Maintenance 1 Tahun'],
    highlight: false, icon: Rocket,
  },
];

function formatRupiah(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function PricingSection() {
  const [isBulanan, setIsBulanan] = useState(true);
  const paket = isBulanan ? paketBulanan : paketProyek;

  return (
    <section id="harga" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #FFFBF3 50%, #FFF8E7 100%)' }}>
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #F4B94210, transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-12">
          <span className="section-badge mb-3">Paket Harga</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A] mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Pilih <span style={{ color: '#D4941A' }}>Paket</span> Anda
          </h2>
          <p className="text-[#6B6B7B] max-w-lg mx-auto text-sm mb-8">Harga transparan tanpa biaya tersembunyi. Pilih paket yang sesuai kebutuhan bisnis Anda.</p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-3 p-1.5 bg-white rounded-xl border border-[#F0E6D3]">
            <button onClick={() => setIsBulanan(true)}
              className={`${isBulanan ? 'btn-primary btn-small' : 'btn-secondary btn-small'}`}>
              Bulanan
            </button>
            <button onClick={() => setIsBulanan(false)}
              className={`${!isBulanan ? 'btn-primary btn-small' : 'btn-secondary btn-small'}`}>
              Per Proyek
            </button>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5">
          {paket.map((p, i) => (
            <motion.div key={p.nama} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: easing }}
              className={`relative rounded-2xl p-6 transition-all duration-300 ${
                p.highlight
                  ? 'bg-white border-2 border-[#F4B942] shadow-xl shadow-[#F4B942]/15 scale-[1.02]'
                  : 'bg-white/80 border border-[#F0E6D3] hover:border-[#F4B942]/30 hover:shadow-lg'
              }`}>
              {p.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#F4B942] text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                  Paling Populer
                </div>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.highlight ? 'bg-[#F4B942]' : 'bg-[#FFF8E7]'}`}>
                  <p.icon size={20} className={p.highlight ? 'text-white' : 'text-[#D4941A]'} />
                </div>
                <h3 className="font-bold text-[#2D2D3A] text-lg">{p.nama}</h3>
              </div>

              <p className="text-[#6B6B7B] text-sm mb-4">{p.deskripsi}</p>

              <div className="mb-5">
                <span className="text-3xl font-bold text-[#2D2D3A]">{formatRupiah(p.harga)}</span>
                <span className="text-[#6B6B7B] text-sm">{p.satuan}</span>
              </div>

              <ul className="space-y-2.5 mb-6">
                {p.fitur.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={14} className="text-[#F4B942] mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-[#2D2D3A]/80">{f}</span>
                  </li>
                ))}
              </ul>

              <a href="https://wa.me/6285601771312" target="_blank" rel="noopener noreferrer"
                className={`block w-full text-center ${p.highlight ? 'btn-primary' : 'btn-secondary'}`}>
                Pilih Paket
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

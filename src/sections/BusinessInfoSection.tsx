import { motion } from 'framer-motion';
import { Building2, MapPin, BadgeCheck, Clock, FileCheck } from 'lucide-react';

const infoRows = [
  { label: 'Nama Perusahaan', value: 'PT Karya Cipta Solusi' },
  { label: 'Status Badan Usaha', value: 'Perseroan Terbatas (PT)' },
  { label: 'Status Operasional', value: 'Aktif Beroperasi' },
  { label: 'Bidang Usaha', value: 'Teknologi Informasi & Software' },
  { label: 'Tahun Berdiri', value: '2024' },
];

export default function BusinessInfoSection() {
  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-14">
          <span className="section-badge mb-3">Informasi Bisnis</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Detail <span className="text-[#0F4C81]">Perusahaan</span></h2>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6 lg:gap-8">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
            className="warm-card p-6 lg:p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#2563EB] flex items-center justify-center"><Building2 size={20} className="text-white" /></div>
              <h3 className="text-lg font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Profil Perusahaan</h3>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {infoRows.map((row) => (
                <div key={row.label} className="flex flex-col sm:flex-row sm:items-center py-3.5 gap-0.5 sm:gap-4">
                  <span className="text-xs text-[#475569] sm:w-48 flex-shrink-0 font-medium uppercase tracking-wider">{row.label}</span>
                  <span className="text-sm font-semibold text-[#0F172A]">{row.value}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <div className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }}
              className="warm-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#0F4C81] flex items-center justify-center"><MapPin size={20} className="text-white" /></div>
                <h3 className="text-lg font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Alamat</h3>
              </div>
              <address className="not-italic text-sm text-[#475569] leading-relaxed">
                Kp. Sindangkarsa, RT.05/RW.15<br />Kel. Sukamaju Baru, Kec. Tapos<br />Kota Depok, Jawa Barat 16455
              </address>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.3 }}
              className="warm-card p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] flex items-center justify-center"><FileCheck size={20} style={{ color: '#1D4ED8' }} /></div>
                <h3 className="text-lg font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Legalitas</h3>
              </div>
              <div className="space-y-3">
                {[{ icon: BadgeCheck, title: 'Badan Usaha Resmi', desc: 'Terdaftar sebagai Perseroan Terbatas (PT)' },
                  { icon: Clock, title: 'Aktif Beroperasi', desc: 'Siap melayani kebutuhan teknologi bisnis Anda' }].map((item) => (
                  <div key={item.title} className="flex items-start gap-2.5">
                    <item.icon size={15} className="text-[#2563EB] mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-sm font-semibold text-[#0F172A]">{item.title}</span>
                      <p className="text-xs text-[#475569]">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}

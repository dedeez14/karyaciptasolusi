import { motion } from 'framer-motion';
import { ArrowUpRight, MessagesSquare, Globe, Package, Cloud, Database } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const services = [
  {
    id: '01',
    title: 'Konsultasi IT',
    desc: 'Konsultasi teknologi informasi, manajemen infrastruktur IT, dan perencanaan digital transformation.',
    img: '/images/service-consulting.jpg',
    icon: MessagesSquare,
    span: 'lg:col-span-2',
  },
  {
    id: '02',
    title: 'Pembuatan Website & Aplikasi',
    desc: 'Jasa pembuatan website company profile, toko online, serta aplikasi web, mobile, dan desktop sesuai kebutuhan bisnis Anda.',
    img: '/images/service-programming.jpg',
    icon: Globe,
    span: 'lg:col-span-2',
  },
  {
    id: '03',
    title: 'Penerbitan Software',
    desc: 'Penjualan lisensi dan distribusi produk software untuk bisnis.',
    img: '/images/service-software.jpg',
    icon: Package,
    span: 'lg:col-span-2',
  },
  {
    id: '04',
    title: 'Platform SaaS',
    desc: 'Penyediaan platform web dan layanan Software as a Service untuk komersial.',
    img: '/images/service-saas.jpg',
    icon: Cloud,
    span: 'lg:col-span-3',
  },
  {
    id: '05',
    title: 'Pengolahan Data',
    desc: 'Infrastruktur, hosting, database, dan jasa pengolahan data.',
    img: '/images/service-data.jpg',
    icon: Database,
    span: 'lg:col-span-3',
  },
];

export default function ServicesSection() {
  return (
    <section id="layanan" className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute top-0 left-0 w-72 h-72 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #2563EB06, transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="mb-14">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="section-badge mb-3">Layanan Kami</span>
              <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Solusi <span className="text-[#0F4C81]">Terintegrasi</span>
              </h2>
            </div>
            <p className="text-[#475569] max-w-md text-sm leading-relaxed">
              Lima pilar layanan utama yang saling terhubung untuk memenuhi kebutuhan teknologi bisnis Anda secara menyeluruh.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-5">
          {services.map((svc, i) => (
            <motion.div key={svc.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: easing }}
              className={svc.span}>
              <a
                href={`https://wa.me/6283898911244?text=${encodeURIComponent(`Halo, saya ingin konsultasi tentang layanan ${svc.title}`)}`}
                target="_blank" rel="noopener noreferrer"
                className="group relative flex flex-col h-full bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden transition-all duration-300 hover:border-[#2563EB]/40 hover:shadow-xl hover:shadow-[#2563EB]/10 hover:-translate-y-1"
              >
                {/* Gambar dengan overlay duotone biru agar serasi dengan tema */}
                <div className="relative h-44 overflow-hidden flex-shrink-0">
                  <img src={svc.img} alt={svc.title} loading="lazy" decoding="async"
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(15,76,129,0.15) 0%, rgba(15,23,42,0.05) 55%, rgba(255,255,255,0.9) 100%)' }} />

                  {/* Nomor */}
                  <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm text-[#1D4ED8] text-xs font-bold shadow-sm" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {svc.id}
                  </span>

                </div>

                {/* Konten di panel putih - kontras penuh */}
                <div className="relative flex flex-col flex-1 px-6 pt-10 pb-6">
                  {/* Ikon mengambang di batas gambar-konten */}
                  <div className="absolute -top-6 left-6 w-12 h-12 rounded-xl flex items-center justify-center shadow-lg shadow-[#2563EB]/25 group-hover:scale-110 transition-transform duration-300"
                    style={{ background: 'linear-gradient(135deg, #2563EB, #1D4ED8)' }}>
                    <svc.icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-[#0F172A] font-bold text-lg lg:text-xl mb-2 group-hover:text-[#1D4ED8] transition-colors" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                    {svc.title}
                  </h3>
                  <p className="text-[#475569] text-sm leading-relaxed mb-5">{svc.desc}</p>
                  <span className="mt-auto inline-flex items-center gap-1.5 text-[#1D4ED8] text-xs font-bold">
                    Konsultasikan Layanan Ini
                    <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-300" />
                  </span>
                </div>
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

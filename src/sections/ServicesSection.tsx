import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const services = [
  { id: '01', title: 'Konsultasi IT', desc: 'Konsultasi teknologi informasi, manajemen infrastruktur IT, dan perencanaan digital transformation.', img: '/images/service-consulting.png', span: 'md:col-span-2' },
  { id: '02', title: 'Pengembangan Aplikasi', desc: 'Jasa pembuatan aplikasi web, mobile, dan desktop sesuai kebutuhan bisnis Anda.', img: '/images/service-programming.png', span: 'md:col-span-1' },
  { id: '03', title: 'Penerbitan Software', desc: 'Penjualan lisensi dan distribusi produk software untuk bisnis.', img: '/images/service-software.png', span: 'md:col-span-1' },
  { id: '04', title: 'Platform SaaS', desc: 'Penyediaan platform web dan layanan Software as a Service untuk komersial.', img: '/images/service-saas.png', span: 'md:col-span-1 md:row-span-2' },
  { id: '05', title: 'Pengolahan Data', desc: 'Infrastruktur, hosting, database, dan jasa pengolahan data.', img: '/images/service-data.png', span: 'md:col-span-2' },
];

export default function ServicesSection() {
  return (
    <section id="layanan" className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute top-0 left-0 w-72 h-72 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #F4B94206, transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="mb-14">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="section-badge mb-3">Layanan Kami</span>
              <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Solusi <span className="text-[#0F4C81]">Terintegrasi</span>
              </h2>
            </div>
            <p className="text-[#6B6B7B] max-w-md text-sm leading-relaxed">
              Lima pilar layanan utama yang saling terhubung untuk memenuhi kebutuhan teknologi bisnis Anda secara menyeluruh.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-5 auto-rows-[220px]">
          {services.map((svc, i) => (
            <motion.div key={svc.id} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: easing }}
              className={`${svc.span} relative rounded-2xl overflow-hidden group cursor-pointer card-3d border border-[#F0E6D3]`}>
              <img src={svc.img} alt={svc.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              <div className="absolute inset-0 bg-gradient-to-t from-[#2D2D3A] via-[#2D2D3A]/40 to-transparent" />
              <div className="absolute inset-0 p-6 flex flex-col justify-end">
                <span className="text-[#F4B942]/60 text-xs font-bold mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{svc.id}</span>
                <h3 className="text-white font-bold text-xl lg:text-2xl mb-2 group-hover:text-[#F4B942] transition-colors" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{svc.title}</h3>
                <p className="text-white/50 text-sm mb-3 line-clamp-2">{svc.desc}</p>
                <div className="flex items-center gap-1 text-[#F4B942] text-xs font-semibold opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0">
                  Selengkapnya <ArrowUpRight size={14} />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

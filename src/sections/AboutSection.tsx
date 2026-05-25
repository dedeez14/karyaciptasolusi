import { motion } from 'framer-motion';
import { Target, Lightbulb, Heart, ArrowUpRight } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const values = [
  { icon: Target, title: 'Visi', desc: 'Menjadi mitra teknologi terpercaya yang menginspirasi transformasi digital di Indonesia.', bg: 'bg-[#F4B942]', iconColor: 'text-white' },
  { icon: Lightbulb, title: 'Misi', desc: 'Menyediakan solusi teknologi inovatif, berkualitas, dan terjangkau untuk UMKM dan korporasi.', bg: 'bg-[#0F4C81]', iconColor: 'text-white' },
  { icon: Heart, title: 'Nilai', desc: 'Integritas, inovasi berkelanjutan, dan komitmen pada kepuasan klien dalam setiap proyek.', bg: 'bg-[#FFF8E7]', iconColor: 'text-[#D4941A]' },
];

export default function AboutSection() {
  return (
    <section id="tentang" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFBF3 0%, #FFFFFF 50%, #FFFBF3 100%)' }}>
      <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-30" style={{ background: 'radial-gradient(circle, #F4B94208, transparent 70%)' }} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-12">
          <span className="section-badge mb-3">Tentang Kami</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Siapa <span style={{ color: '#D4941A' }}>Kami</span></h2>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-10 items-center mb-16">
          <motion.div initial={{ opacity: 0, x: -40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: easing }} className="relative">
            <div className="rounded-2xl overflow-hidden border border-[#F0E6D3] shadow-lg">
              <img src="/images/about-founder.png" alt="Founder" className="w-full max-w-md mx-auto h-auto object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3, duration: 0.5 }}
              className="absolute -bottom-4 left-4 sm:left-8 bg-white rounded-xl p-4 shadow-xl border border-[#F0E6D3] max-w-xs">
              <p className="font-bold text-[#2D2D3A] text-sm">Founder & Developer</p>
              <p className="text-[#6B6B7B] text-xs">PT Karya Cipta Solusi</p>
            </motion.div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: easing }}>
            <p className="text-[#6B6B7B] leading-relaxed mb-5 text-sm">PT Karya Cipta Solusi didirikan dengan semangat untuk membantu bisnis di Indonesia menghadapi era digital. Berawal dari pengalaman mendalam dalam teknologi informasi, kami memahami tantangan unik yang dihadapi pelaku usaha.</p>
            <p className="text-[#6B6B7B] leading-relaxed mb-8 text-sm">Berbasis di Depok, Jawa Barat, kami berkomitmen memberikan solusi teknologi terbaik. Setiap proyek adalah dedikasi untuk hasil yang optimal dan memuaskan.</p>
            <a href="https://wa.me/6285601771312" target="_blank" rel="noopener noreferrer" className="group btn-ghost hover:no-underline" style={{ color: '#D4941A' }}>
              Diskusikan kebutuhan Anda <ArrowUpRight size={16} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
            </a>
          </motion.div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {values.map((v, i) => (
            <motion.div key={v.title} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: easing }} className="warm-card p-6">
              <div className={`w-12 h-12 rounded-xl ${v.bg} flex items-center justify-center mb-4`}>
                <v.icon size={22} className={v.iconColor} />
              </div>
              <h3 className="text-lg font-bold text-[#2D2D3A] mb-2" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{v.title}</h3>
              <p className="text-[#6B6B7B] text-sm leading-relaxed">{v.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

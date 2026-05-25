import { motion } from 'framer-motion';
import { Clock, ArrowUpRight, Tag } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const articles = [
  {
    id: 1, title: 'Kenapa UMKM Perlu Digitalisasi di 2026?',
    excerpt: 'Era digital menuntut UMKM untuk beradaptasi. Pelajari mengapa digitalisasi bukan lagi pilihan, melainkan kebutuhan.',
    category: 'Bisnis', readTime: '5 menit', date: '15 Mei 2026',
    color: 'from-[#F4B942] to-[#D4941A]',
  },
  {
    id: 2, title: 'React vs Vue: Mana yang Cocok untuk Proyek Anda?',
    excerpt: 'Perbandingan mendalam antara dua framework JavaScript populer untuk membantu Anda memilih teknologi yang tepat.',
    category: 'Teknologi', readTime: '8 menit', date: '10 Mei 2026',
    color: 'from-[#0F4C81] to-[#1E6BAF]',
  },
  {
    id: 3, title: 'Cara Memilih Jasa Pengembangan Aplikasi yang Tepat',
    excerpt: 'Tips penting dalam memilih vendor pengembangan aplikasi agar proyek Anda berjalan lancar dan sesuai anggaran.',
    category: 'Tips', readTime: '6 menit', date: '5 Mei 2026',
    color: 'from-[#1E6BAF] to-[#0F4C81]',
  },
  {
    id: 4, title: 'Mengenal ERP System untuk Bisnis Indonesia',
    excerpt: 'Apa itu ERP dan bagaimana sistem ini dapat membantu efisiensi operasional bisnis Anda secara signifikan.',
    category: 'Edukasi', readTime: '7 menit', date: '1 Mei 2026',
    color: 'from-[#D4941A] to-[#F4B942]',
  },
];

export default function BlogSection() {
  return (
    <section id="blog" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #FFFBF3 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-12">
          <span className="section-badge mb-3">Blog & Artikel</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Insight & <span style={{ color: '#D4941A' }}>Tips</span>
          </h2>
          <p className="text-[#6B6B7B] max-w-lg mx-auto text-sm">Artikel seputar teknologi, bisnis, dan tips digital untuk pertumbuhan usaha Anda.</p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {articles.map((article, i) => (
            <motion.article
              key={article.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: easing }}
              className="warm-card overflow-hidden group cursor-pointer"
            >
              <div className={`h-32 bg-gradient-to-br ${article.color} flex items-center justify-center relative overflow-hidden`}>
                <span className="text-4xl font-bold text-white/20">{article.category.charAt(0)}</span>
                <div className="absolute top-3 left-3">
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded text-[10px] text-white font-medium">
                    <Tag size={10} /> {article.category}
                  </span>
                </div>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              </div>

              <div className="p-5">
                <div className="flex items-center gap-3 mb-3 text-[10px] text-[#6B6B7B]">
                  <span>{article.date}</span>
                  <span className="flex items-center gap-1"><Clock size={10} /> {article.readTime}</span>
                </div>
                <h3 className="font-bold text-[#2D2D3A] text-sm mb-2 group-hover:text-[#D4941A] transition-colors line-clamp-2">
                  {article.title}
                </h3>
                <p className="text-xs text-[#6B6B7B] line-clamp-3 mb-3">{article.excerpt}</p>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-[#D4941A] opacity-0 group-hover:opacity-100 transition-opacity">
                  Baca selengkapnya <ArrowUpRight size={10} />
                </span>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

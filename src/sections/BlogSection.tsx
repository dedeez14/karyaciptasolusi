import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Clock, ArrowUpRight, Tag } from 'lucide-react';
import { blogPosts } from '../data/blogPosts';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const articles = blogPosts.slice(0, 4);

export default function BlogSection() {
  return (
    <section id="blog" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-12">
          <span className="section-badge mb-3">Blog & Artikel</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Insight & <span style={{ color: '#1D4ED8' }}>Tips</span>
          </h2>
          <p className="text-[#475569] max-w-lg mx-auto text-sm">Artikel seputar teknologi, bisnis, dan tips digital untuk pertumbuhan usaha Anda.</p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {articles.map((article, i) => (
            <motion.article
              key={article.slug}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: easing }}
            >
              <Link to={`/blog/${article.slug}`} className="warm-card overflow-hidden group block h-full">
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
                  <div className="flex items-center gap-3 mb-3 text-[10px] text-[#475569]">
                    <span>{article.date}</span>
                    <span className="flex items-center gap-1"><Clock size={10} /> {article.readTime}</span>
                  </div>
                  <h3 className="font-bold text-[#0F172A] text-sm mb-2 group-hover:text-[#1D4ED8] transition-colors line-clamp-2">
                    {article.title}
                  </h3>
                  <p className="text-xs text-[#475569] line-clamp-3 mb-3">{article.excerpt}</p>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[#1D4ED8] opacity-0 group-hover:opacity-100 transition-opacity">
                    Baca selengkapnya <ArrowUpRight size={10} />
                  </span>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3, ease: easing }}
          className="text-center mt-10">
          <Link to="/blog" className="btn-secondary">
            Lihat Semua Artikel
            <ArrowUpRight size={15} />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

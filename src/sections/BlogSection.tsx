import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Clock, ArrowUpRight } from 'lucide-react';
import { blogPosts } from '../data/blogIndex';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const articles = blogPosts.slice(0, 4);

export default function BlogSection() {
  return (
    <section
      id="blog"
      className="relative py-24 lg:py-32 overflow-hidden"
      style={{ background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: easing }}
          className="text-center mb-12"
        >
          <span className="section-badge mb-3">Blog &amp; Artikel</span>
          <h2
            className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Insight &amp; <span style={{ color: '#1D4ED8' }}>Tips</span>
          </h2>
          <p className="text-[#475569] max-w-lg mx-auto text-sm">
            {blogPosts.length} artikel seputar website, SEO, dan digitalisasi bisnis — gratis dibaca
            siapa saja.
          </p>
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
              <Link
                to={`/blog/${article.slug}`}
                className="group flex flex-col h-full bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden transition-all duration-300 hover:border-[#2563EB]/40 hover:shadow-xl hover:shadow-[#2563EB]/10 hover:-translate-y-1"
              >
                <div className="relative h-36 overflow-hidden flex-shrink-0 bg-[#EFF6FF]">
                  <img
                    src={article.image}
                    alt={article.title}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.visibility = 'hidden';
                    }}
                  />
                  <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm text-[#1D4ED8] text-[10px] font-bold">
                    {article.category}
                  </span>
                </div>

                <div className="flex flex-col flex-1 p-5">
                  <div className="flex items-center gap-3 mb-2.5 text-[10px] text-[#475569]">
                    <span>{article.date}</span>
                    <span className="flex items-center gap-1">
                      <Clock size={10} /> {article.readTime}
                    </span>
                  </div>
                  <h3 className="font-bold text-[#0F172A] text-sm leading-snug mb-2 group-hover:text-[#1D4ED8] transition-colors">
                    {article.title}
                  </h3>
                  <p className="text-xs text-[#475569] line-clamp-3 mb-3">{article.excerpt}</p>
                  <span className="mt-auto flex items-center gap-1 text-[10px] font-bold text-[#1D4ED8]">
                    Baca selengkapnya <ArrowUpRight size={11} />
                  </span>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3, ease: easing }}
          className="text-center mt-10"
        >
          <Link to="/blog" className="btn-secondary">
            Lihat Semua {blogPosts.length} Artikel
            <ArrowUpRight size={15} />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

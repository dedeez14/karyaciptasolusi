import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Clock, ArrowUpRight, Search, ArrowRight } from 'lucide-react';
import { blogPosts, categories } from '../data/blogIndex';
import { usePageMeta } from '../hooks/usePageMeta';
import SubPageHeader from '../components/SubPageHeader';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];
const PER_PAGE = 12;

export default function Blog() {
  const [query, setQuery] = useState('');
  const [activeCat, setActiveCat] = useState('Semua');
  const [visible, setVisible] = useState(PER_PAGE);

  usePageMeta({
    title: 'Blog & Artikel — Tips Website, SEO, dan Digitalisasi Bisnis | PT Karya Cipta Solusi',
    description:
      'Kumpulan artikel edukatif seputar pembuatan website, SEO, toko online, aplikasi bisnis, dan keamanan digital — ditulis dengan bahasa yang mudah dipahami pemilik usaha.',
    canonicalPath: '/blog',
  });

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return blogPosts.filter((p) => {
      const matchCat = activeCat === 'Semua' || p.category === activeCat;
      const matchTerm =
        !term ||
        p.title.toLowerCase().includes(term) ||
        p.excerpt.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term);
      return matchCat && matchTerm;
    });
  }, [query, activeCat]);

  const shown = filtered.slice(0, visible);

  const resetTo = (fn: () => void) => {
    fn();
    setVisible(PER_PAGE);
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC]">
      <SubPageHeader subtitle="Blog & Artikel" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easing }}
          className="text-center mb-10"
        >
          <span className="section-badge mb-3">Blog</span>
          <h1
            className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Insight &amp; <span style={{ color: '#1D4ED8' }}>Tips</span>
          </h1>
          <p className="text-[#475569] max-w-xl mx-auto text-sm leading-relaxed">
            {blogPosts.length} artikel edukatif seputar website, SEO, toko online, aplikasi bisnis,
            dan keamanan digital — ditulis dengan bahasa yang mudah dipahami.
          </p>
        </motion.div>

        {/* Pencarian */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: easing }}
          className="relative max-w-xl mx-auto mb-6"
        >
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#475569]" />
          <input
            value={query}
            onChange={(e) => resetTo(() => setQuery(e.target.value))}
            placeholder="Cari artikel, misalnya: domain, SEO, toko online..."
            aria-label="Cari artikel"
            className="input-field pl-11"
          />
        </motion.div>

        {/* Filter kategori */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: easing }}
          className="flex flex-wrap justify-center gap-2 mb-10"
        >
          {['Semua', ...categories].map((cat) => (
            <button
              key={cat}
              onClick={() => resetTo(() => setActiveCat(cat))}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-200 border ${
                activeCat === cat
                  ? 'bg-[#1D4ED8] text-white border-[#1D4ED8] shadow-md shadow-[#2563EB]/20'
                  : 'bg-white text-[#475569] border-[#E2E8F0] hover:border-[#2563EB]/40 hover:text-[#1D4ED8]'
              }`}
            >
              {cat}
            </button>
          ))}
        </motion.div>

        {filtered.length === 0 ? (
          <p className="text-center text-[#475569] text-sm py-16">
            Tidak ada artikel yang cocok dengan pencarian Anda. Coba kata kunci lain.
          </p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {shown.map((post, i) => (
                <motion.article
                  key={post.slug}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: Math.min(i, 8) * 0.05, ease: easing }}
                >
                  <Link
                    to={`/blog/${post.slug}`}
                    className="group flex flex-col h-full bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden transition-all duration-300 hover:border-[#2563EB]/40 hover:shadow-xl hover:shadow-[#2563EB]/10 hover:-translate-y-1"
                  >
                    <div className="relative h-40 overflow-hidden flex-shrink-0 bg-[#EFF6FF]">
                      <img
                        src={post.image}
                        alt={post.title}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.visibility = 'hidden';
                        }}
                      />
                      <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/90 backdrop-blur-sm text-[#1D4ED8] text-[10px] font-bold">
                        {post.category}
                      </span>
                    </div>

                    <div className="flex flex-col flex-1 p-5">
                      <div className="flex items-center gap-3 mb-2.5 text-[10px] text-[#475569]">
                        <span>{post.date}</span>
                        <span className="flex items-center gap-1">
                          <Clock size={10} /> {post.readTime}
                        </span>
                      </div>
                      <h2 className="font-bold text-[#0F172A] text-[15px] leading-snug mb-2 group-hover:text-[#1D4ED8] transition-colors">
                        {post.title}
                      </h2>
                      <p className="text-xs text-[#475569] leading-relaxed line-clamp-3 mb-4">
                        {post.excerpt}
                      </p>
                      <span className="mt-auto flex items-center gap-1 text-[10px] font-bold text-[#1D4ED8]">
                        Baca selengkapnya <ArrowUpRight size={11} />
                      </span>
                    </div>
                  </Link>
                </motion.article>
              ))}
            </div>

            {visible < filtered.length && (
              <div className="text-center mt-10">
                <button onClick={() => setVisible((v) => v + PER_PAGE)} className="btn-secondary">
                  Muat Lebih Banyak
                  <ArrowRight size={15} />
                </button>
                <p className="text-xs text-[#475569]/70 mt-3">
                  Menampilkan {shown.length} dari {filtered.length} artikel
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

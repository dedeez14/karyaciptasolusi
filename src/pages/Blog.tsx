import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Clock, ArrowUpRight, Tag } from 'lucide-react';
import { blogPosts } from '../data/blogPosts';
import { usePageMeta } from '../hooks/usePageMeta';
import SubPageHeader from '../components/SubPageHeader';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

export default function Blog() {
  usePageMeta({
    title: 'Blog & Artikel — Tips Pembuatan Website & Digitalisasi Bisnis | PT Karya Cipta Solusi',
    description: 'Kumpulan artikel seputar jasa pembuatan website, biaya pembuatan website, tips memilih vendor, dan strategi digitalisasi bisnis dari tim PT Karya Cipta Solusi.',
    canonicalPath: '/blog',
  });

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC]">
      <SubPageHeader subtitle="Blog & Artikel" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easing }} className="text-center mb-12">
          <span className="section-badge mb-3">Blog</span>
          <h1 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Insight &amp; <span style={{ color: '#1D4ED8' }}>Tips</span>
          </h1>
          <p className="text-[#475569] max-w-lg mx-auto text-sm">
            Panduan pembuatan website, tips memilih vendor, dan strategi digitalisasi untuk pertumbuhan bisnis Anda.
          </p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {blogPosts.map((post, i) => (
            <motion.article key={post.slug} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: easing }}>
              <Link to={`/blog/${post.slug}`} className="warm-card overflow-hidden group block h-full">
                <div className={`h-32 bg-gradient-to-br ${post.color} flex items-center justify-center relative overflow-hidden`}>
                  <span className="text-4xl font-bold text-white/20">{post.category.charAt(0)}</span>
                  <span className="absolute top-3 left-3 flex items-center gap-1 px-2 py-0.5 bg-white/20 backdrop-blur-sm rounded text-[10px] text-white font-medium">
                    <Tag size={10} /> {post.category}
                  </span>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-3 text-[10px] text-[#475569]">
                    <span>{post.date}</span>
                    <span className="flex items-center gap-1"><Clock size={10} /> {post.readTime}</span>
                  </div>
                  <h2 className="font-bold text-[#0F172A] text-sm mb-2 group-hover:text-[#1D4ED8] transition-colors">
                    {post.title}
                  </h2>
                  <p className="text-xs text-[#475569] line-clamp-3 mb-3">{post.excerpt}</p>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[#1D4ED8]">
                    Baca selengkapnya <ArrowUpRight size={10} />
                  </span>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      </main>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Clock, ArrowUpRight, Search, ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import { blogPosts, categories } from '../data/blogIndex';
import { themeOf } from '../data/categoryTheme';
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

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of blogPosts) map[p.category] = (map[p.category] ?? 0) + 1;
    return map;
  }, []);

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

  const isBrowsingAll = activeCat === 'Semua' && !query.trim();
  const featured = isBrowsingAll ? filtered[0] : null;
  const rest = featured ? filtered.slice(1) : filtered;
  const shown = rest.slice(0, visible);

  const update = (fn: () => void) => {
    fn();
    setVisible(PER_PAGE);
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC]">
      <SubPageHeader subtitle="Blog & Artikel" />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0F4C81 0%, #1D4ED8 60%, #2563EB 100%)' }}>
        <div
          className="absolute inset-0 opacity-[0.13]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1.5px, transparent 1.5px)', backgroundSize: '30px 30px' }}
        />
        <div className="absolute -top-24 -right-16 w-96 h-96 rounded-full bg-white/[0.07]" />
        <div className="absolute -bottom-32 -left-10 w-80 h-80 rounded-full bg-white/[0.05]" />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-14 pb-12 lg:pt-20 lg:pb-16 text-center">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: easing }}>
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/15 backdrop-blur-sm text-white text-[11px] font-bold uppercase tracking-[0.18em] mb-5">
              <Sparkles size={13} /> Pusat Belajar Digital
            </span>
            <h1
              className="text-4xl lg:text-[3.25rem] font-bold text-white leading-[1.1] mb-4"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Belajar Bikin Bisnis Anda
              <br />
              <span className="text-[#93C5FD]">Tumbuh secara Digital</span>
            </h1>
            <p className="text-white/75 max-w-xl mx-auto text-sm lg:text-[15px] leading-relaxed">
              {blogPosts.length} artikel praktis tentang website, SEO, toko online, dan keamanan
              digital. Ditulis tanpa jargon — gratis dibaca siapa saja.
            </p>
          </motion.div>

          {/* Pencarian */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.12, ease: easing }}
            className="relative max-w-lg mx-auto mt-8"
          >
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#475569]" />
            <input
              value={query}
              onChange={(e) => update(() => setQuery(e.target.value))}
              placeholder="Cari: domain, SEO, toko online, keamanan..."
              aria-label="Cari artikel"
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm bg-white text-[#0F172A] placeholder:text-[#94A3B8] shadow-xl shadow-[#0F172A]/15 outline-none focus:ring-4 focus:ring-white/25 transition-shadow"
            />
          </motion.div>
        </div>
      </section>

      {/* ── Filter kategori (menempel saat digulir) ── */}
      <div className="sticky top-16 z-40 bg-[#F8FAFC] border-b border-[#E2E8F0] shadow-sm shadow-[#0F172A]/[0.03]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none justify-start lg:justify-center">
            <CatChip
              label="Semua"
              count={blogPosts.length}
              active={activeCat === 'Semua'}
              onClick={() => update(() => setActiveCat('Semua'))}
            />
            {categories.map((cat) => (
              <CatChip
                key={cat}
                label={cat}
                count={counts[cat] ?? 0}
                color={themeOf(cat).ink}
                tint={themeOf(cat).tint}
                active={activeCat === cat}
                onClick={() => update(() => setActiveCat(cat))}
              />
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-14 h-14 rounded-2xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4">
              <Search size={24} className="text-[#1D4ED8]" />
            </div>
            <p className="text-[#0F172A] font-bold mb-1">Belum ada yang cocok</p>
            <p className="text-[#475569] text-sm mb-5">
              Coba kata kunci lain, atau lihat semua artikel yang tersedia.
            </p>
            <button
              onClick={() => update(() => { setQuery(''); setActiveCat('Semua'); })}
              className="btn-secondary"
            >
              Tampilkan Semua Artikel
            </button>
          </div>
        ) : (
          <>
            {/* Artikel unggulan */}
            {featured && <FeaturedCard post={featured} />}

            {!isBrowsingAll && (
              <p className="text-xs text-[#475569] mb-5">
                <span className="font-bold text-[#0F172A]">{filtered.length}</span> artikel
                {activeCat !== 'Semua' && <> di kategori <span className="font-bold text-[#0F172A]">{activeCat}</span></>}
                {query.trim() && <> untuk pencarian &ldquo;{query.trim()}&rdquo;</>}
              </p>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {shown.map((post, i) => (
                <ArticleCard key={post.slug} post={post} index={i} />
              ))}
            </div>

            {visible < rest.length && (
              <div className="text-center mt-12">
                <button onClick={() => setVisible((v) => v + PER_PAGE)} className="btn-primary">
                  Muat {Math.min(PER_PAGE, rest.length - visible)} Artikel Lagi
                  <ArrowRight size={15} />
                </button>
                <div className="max-w-xs mx-auto mt-5">
                  <div className="h-1 rounded-full bg-[#E2E8F0] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#2563EB] transition-all duration-500"
                      style={{ width: `${((shown.length + (featured ? 1 : 0)) / filtered.length) * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[#475569] mt-2">
                    {shown.length + (featured ? 1 : 0)} dari {filtered.length} artikel
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ── Komponen kecil ── */

function CatChip({
  label,
  count,
  active,
  onClick,
  color = '#1D4ED8',
  tint = '#EFF6FF',
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: string;
  tint?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all duration-200"
      style={
        active
          ? { background: color, borderColor: color, color: '#fff', boxShadow: `0 4px 14px ${color}33` }
          : { background: '#fff', borderColor: '#E2E8F0', color: '#475569' }
      }
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = tint;
          e.currentTarget.style.color = color;
          e.currentTarget.style.borderColor = `${color}55`;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = '#fff';
          e.currentTarget.style.color = '#475569';
          e.currentTarget.style.borderColor = '#E2E8F0';
        }
      }}
    >
      {label}
      <span className={`text-[10px] font-semibold ${active ? 'opacity-70' : 'opacity-50'}`}>{count}</span>
    </button>
  );
}

function FeaturedCard({ post }: { post: (typeof blogPosts)[number] }) {
  const t = themeOf(post.category);
  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: easing }}
      className="mb-10"
    >
      <Link
        to={`/blog/${post.slug}`}
        className="group grid lg:grid-cols-2 bg-white rounded-3xl border border-[#E2E8F0] overflow-hidden transition-all duration-300 hover:border-[#2563EB]/40 hover:shadow-2xl hover:shadow-[#2563EB]/10"
      >
        <div className="relative h-52 lg:h-full min-h-[220px] overflow-hidden" style={{ background: t.tint }}>
          <img
            src={post.image}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700"
          />
        </div>
        <div className="p-7 lg:p-10 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider"
              style={{ background: t.tint, color: t.ink }}
            >
              <BookOpen size={11} /> Artikel Terbaru
            </span>
            <span className="text-[11px] text-[#475569]">{post.category}</span>
          </div>
          <h2
            className="text-2xl lg:text-3xl font-bold text-[#0F172A] leading-tight mb-3 group-hover:text-[#1D4ED8] transition-colors"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {post.title}
          </h2>
          <p className="text-sm text-[#475569] leading-relaxed mb-5 line-clamp-3">{post.excerpt}</p>
          <div className="flex items-center gap-4 text-[11px] text-[#475569] mb-5">
            <span>{post.date}</span>
            <span className="flex items-center gap-1">
              <Clock size={11} /> {post.readTime} baca
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: t.ink }}>
            Mulai Baca
            <ArrowRight size={15} className="group-hover:translate-x-1 transition-transform" />
          </span>
        </div>
      </Link>
    </motion.article>
  );
}

function ArticleCard({ post, index }: { post: (typeof blogPosts)[number]; index: number }) {
  const t = themeOf(post.category);
  return (
    <motion.article
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: Math.min(index, 8) * 0.05, ease: easing }}
    >
      <Link
        to={`/blog/${post.slug}`}
        className="group flex flex-col h-full bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
        style={{ ['--hover' as string]: t.ink }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = `${t.ink}66`)}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#E2E8F0')}
      >
        <div className="relative h-40 overflow-hidden flex-shrink-0" style={{ background: t.tint }}>
          <img
            src={post.image}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
          <span
            className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-white/95 backdrop-blur-sm text-[10px] font-bold"
            style={{ color: t.ink }}
          >
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
          <h3 className="font-bold text-[#0F172A] text-[15px] leading-snug mb-2 transition-colors group-hover:text-[#1D4ED8]">
            {post.title}
          </h3>
          <p className="text-xs text-[#475569] leading-relaxed line-clamp-3 mb-4">{post.excerpt}</p>
          <span
            className="mt-auto flex items-center gap-1 text-[10px] font-bold"
            style={{ color: t.ink }}
          >
            Baca selengkapnya
            <ArrowUpRight size={11} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </span>
        </div>
      </Link>
    </motion.article>
  );
}

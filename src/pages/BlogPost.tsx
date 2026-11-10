import { useEffect, useMemo, useState } from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Clock, Calendar, Tag, ArrowRight, ArrowUpRight, ArrowLeft, Check } from 'lucide-react';
import type { BlogBlock } from '../data/blogTypes';
import { blogPosts, getPostBySlug, loadContent, relatedPosts } from '../data/blogIndex';
import { themeOf } from '../data/categoryTheme';
import { usePageMeta } from '../hooks/usePageMeta';
import SubPageHeader from '../components/SubPageHeader';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

function BlockRenderer({ block, accent }: { block: BlogBlock; accent: string }) {
  if (block.type === 'h2') {
    return (
      <h2
        className="text-[22px] lg:text-[26px] font-bold text-[#0F172A] mt-11 mb-4 scroll-mt-24"
        style={{ fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {block.text}
      </h2>
    );
  }
  if (block.type === 'ul') {
    return (
      <ul className="space-y-3 my-6">
        {block.items?.map((item) => (
          <li key={item} className="flex items-start gap-3 text-[17px] text-[#334155] leading-[1.75]">
            <span
              className="mt-1 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: `${accent}18` }}
            >
              <Check size={12} strokeWidth={3} style={{ color: accent }} />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-[17px] text-[#334155] leading-[1.8] my-5">{block.text}</p>;
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = slug ? getPostBySlug(slug) : undefined;
  const [content, setContent] = useState<BlogBlock[] | null>(null);

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 28, restDelta: 0.001 });

  useEffect(() => {
    let alive = true;
    setContent(null);
    if (slug) {
      loadContent(slug).then((c) => {
        if (alive) setContent(c);
      });
    }
    return () => {
      alive = false;
    };
  }, [slug]);

  const jsonLd = useMemo(
    () =>
      post && {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.excerpt,
            datePublished: post.isoDate,
            inLanguage: 'id-ID',
            image: `${window.location.origin}${post.image}`,
            articleSection: post.category,
            author: { '@type': 'Organization', name: 'PT Karya Cipta Solusi' },
            publisher: { '@type': 'Organization', name: 'PT Karya Cipta Solusi' },
            mainEntityOfPage: `${window.location.origin}/blog/${post.slug}`,
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Beranda', item: `${window.location.origin}/` },
              { '@type': 'ListItem', position: 2, name: 'Blog', item: `${window.location.origin}/blog` },
              { '@type': 'ListItem', position: 3, name: post.title },
            ],
          },
        ],
      },
    [post],
  );

  usePageMeta({
    title: post ? `${post.title} | PT Karya Cipta Solusi` : 'Artikel | PT Karya Cipta Solusi',
    description: post?.excerpt ?? '',
    canonicalPath: post ? `/blog/${post.slug}` : '/blog',
    jsonLd,
  });

  if (!post) return <Navigate to="/blog" replace />;

  const t = themeOf(post.category);
  const related = relatedPosts(post.slug, 3);

  // artikel sebelum/sesudah berdasarkan urutan tanggal
  const idx = blogPosts.findIndex((p) => p.slug === post.slug);
  const newer = idx > 0 ? blogPosts[idx - 1] : null;
  const older = idx >= 0 && idx < blogPosts.length - 1 ? blogPosts[idx + 1] : null;

  return (
    <div className="min-h-[100dvh] bg-white">
      {/* Indikator progres baca */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 origin-left z-[60]"
        style={{ scaleX: progress, background: `linear-gradient(90deg, ${t.from}, ${t.to})` }}
      />

      <SubPageHeader subtitle="Blog & Artikel" />

      <main>
        {/* Hero artikel */}
        <div className="relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }}>
          <img
            src={post.image}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover opacity-20"
          />
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(135deg, ${t.from}E6, ${t.to}E0)` }}
          />
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 relative z-10">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easing }}>
              <nav aria-label="Breadcrumb" className="mb-5">
                <ol className="flex flex-wrap items-center gap-1.5 text-xs text-white/70">
                  <li>
                    <Link to="/" className="hover:text-white transition-colors">Beranda</Link>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li>
                    <Link to="/blog" className="hover:text-white transition-colors">Blog</Link>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li className="text-white font-medium">{post.category}</li>
                </ol>
              </nav>
              <div className="flex flex-wrap items-center gap-3 mb-5 text-xs text-white/85">
                <span className="flex items-center gap-1 px-2.5 py-1 bg-white/15 backdrop-blur-sm rounded-full font-medium">
                  <Tag size={11} /> {post.category}
                </span>
                <span className="flex items-center gap-1"><Calendar size={12} /> {post.date}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {post.readTime} baca</span>
              </div>
              <h1
                className="text-3xl lg:text-[2.6rem] font-bold text-white leading-[1.15] mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {post.title}
              </h1>
              <p className="text-white/80 text-[15px] leading-relaxed max-w-2xl">{post.excerpt}</p>
            </motion.div>
          </div>
        </div>

        {/* Isi artikel */}
        <article className="max-w-[46rem] mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          {content === null ? (
            <div className="space-y-4 animate-pulse" aria-label="Memuat artikel">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="h-4 rounded bg-[#E2E8F0]" style={{ width: `${92 - (i % 4) * 8}%` }} />
              ))}
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easing }}>
              {content.map((block, i) => (
                <BlockRenderer key={i} block={block} accent={t.ink} />
              ))}
            </motion.div>
          )}

          {/* CTA */}
          <div
            className="mt-14 rounded-2xl p-7 lg:p-8 flex flex-col sm:flex-row items-center justify-between gap-5"
            style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }}
          >
            <div className="text-center sm:text-left">
              <p className="text-white font-bold text-lg mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Butuh website atau aplikasi untuk bisnis Anda?
              </p>
              <p className="text-white/75 text-sm">Konsultasi gratis — harga menyesuaikan kebutuhan Anda.</p>
            </div>
            <a
              href="https://wa.me/6283898911244?text=Halo,%20saya%20ingin%20konsultasi%20pembuatan%20website"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-white hover:bg-[#F8FAFC] transition-colors flex-shrink-0 group"
              style={{ color: t.ink }}
            >
              Chat WhatsApp
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>

          {/* Navigasi artikel sebelumnya / berikutnya */}
          <nav className="mt-12 grid sm:grid-cols-2 gap-4" aria-label="Navigasi artikel">
            {older ? (
              <Link
                to={`/blog/${older.slug}`}
                className="group flex flex-col p-5 rounded-2xl border border-[#E2E8F0] bg-white hover:border-[#2563EB]/40 hover:shadow-lg transition-all duration-300"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#475569] uppercase tracking-wider mb-2">
                  <ArrowLeft size={11} /> Sebelumnya
                </span>
                <span className="font-bold text-sm text-[#0F172A] leading-snug group-hover:text-[#1D4ED8] transition-colors">
                  {older.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {newer && (
              <Link
                to={`/blog/${newer.slug}`}
                className="group flex flex-col p-5 rounded-2xl border border-[#E2E8F0] bg-white hover:border-[#2563EB]/40 hover:shadow-lg transition-all duration-300 sm:text-right"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#475569] uppercase tracking-wider mb-2 sm:justify-end">
                  Berikutnya <ArrowRight size={11} />
                </span>
                <span className="font-bold text-sm text-[#0F172A] leading-snug group-hover:text-[#1D4ED8] transition-colors">
                  {newer.title}
                </span>
              </Link>
            )}
          </nav>

          {/* Artikel terkait */}
          <div className="mt-14 pt-10 border-t border-[#E2E8F0]">
            <h2 className="text-lg font-bold text-[#0F172A] mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Lanjut Baca
            </h2>
            <p className="text-xs text-[#475569] mb-6">Masih di topik {post.category} dan sekitarnya.</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {related.map((r) => {
                const rt = themeOf(r.category);
                return (
                  <Link
                    key={r.slug}
                    to={`/blog/${r.slug}`}
                    className="group flex flex-col bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
                  >
                    <div className="h-24 relative overflow-hidden" style={{ background: rt.tint }}>
                      <img
                        src={r.image}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    </div>
                    <div className="p-4 flex flex-col flex-1">
                      <p className="text-[10px] font-bold mb-1.5" style={{ color: rt.ink }}>
                        {r.category} · {r.readTime}
                      </p>
                      <p className="font-bold text-[13px] text-[#0F172A] leading-snug group-hover:text-[#1D4ED8] transition-colors">
                        {r.title}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="text-center mt-9">
              <Link to="/blog" className="btn-secondary">
                Jelajahi {blogPosts.length} Artikel Lainnya
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}

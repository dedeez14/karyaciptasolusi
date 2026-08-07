import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Clock, Calendar, Tag, ArrowRight, ArrowUpRight } from 'lucide-react';
import { blogPosts, getPostBySlug, type BlogBlock } from '../data/blogPosts';
import { usePageMeta } from '../hooks/usePageMeta';
import SubPageHeader from '../components/SubPageHeader';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

function BlockRenderer({ block }: { block: BlogBlock }) {
  if (block.type === 'h2') {
    return (
      <h2 className="text-xl lg:text-2xl font-bold text-[#0F172A] mt-9 mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {block.text}
      </h2>
    );
  }
  if (block.type === 'ul') {
    return (
      <ul className="space-y-2.5 my-4">
        {block.items?.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-[15px] text-[#475569] leading-relaxed">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] mt-2.5 flex-shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="text-[15px] text-[#475569] leading-relaxed my-4">{block.text}</p>;
}

export default function BlogPost() {
  const { slug } = useParams();
  const post = slug ? getPostBySlug(slug) : undefined;

  const jsonLd = useMemo(() => post && ({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.excerpt,
        datePublished: post.isoDate,
        inLanguage: 'id-ID',
        author: { '@type': 'Organization', name: 'PT Karya Cipta Solusi' },
        publisher: { '@type': 'Organization', name: 'PT Karya Cipta Solusi' },
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
  }), [post]);

  usePageMeta({
    title: post ? `${post.title} | PT Karya Cipta Solusi` : 'Artikel | PT Karya Cipta Solusi',
    description: post?.excerpt ?? '',
    canonicalPath: post ? `/blog/${post.slug}` : '/blog',
    jsonLd,
  });

  if (!post) return <Navigate to="/blog" replace />;

  const related = blogPosts.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="min-h-[100dvh] bg-white">
      <SubPageHeader subtitle="Blog & Artikel" />

      <main>
        {/* Article hero */}
        <div className={`bg-gradient-to-br ${post.color} relative overflow-hidden`}>
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, #FFFFFF 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 relative z-10">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easing }}>
              {/* Breadcrumb */}
              <nav aria-label="Breadcrumb" className="mb-5">
                <ol className="flex flex-wrap items-center gap-1.5 text-xs text-white/70">
                  <li><Link to="/" className="hover:text-white transition-colors">Beranda</Link></li>
                  <li aria-hidden="true">/</li>
                  <li><Link to="/blog" className="hover:text-white transition-colors">Blog</Link></li>
                  <li aria-hidden="true">/</li>
                  <li className="text-white font-medium">{post.category}</li>
                </ol>
              </nav>
              <div className="flex flex-wrap items-center gap-3 mb-5 text-xs text-white/80">
                <span className="flex items-center gap-1 px-2.5 py-1 bg-white/15 backdrop-blur-sm rounded-full font-medium">
                  <Tag size={11} /> {post.category}
                </span>
                <span className="flex items-center gap-1"><Calendar size={12} /> {post.date}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {post.readTime} baca</span>
              </div>
              <h1 className="text-3xl lg:text-4xl font-bold text-white leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {post.title}
              </h1>
            </motion.div>
          </div>
        </div>

        {/* Article body */}
        <motion.article initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease: easing }}
          className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          {post.content.map((block, i) => (
            <BlockRenderer key={i} block={block} />
          ))}

          {/* CTA */}
          <div className="mt-12 rounded-2xl p-7 lg:p-8 flex flex-col sm:flex-row items-center justify-between gap-5"
            style={{ background: 'linear-gradient(135deg, #0F4C81, #1D4ED8)' }}>
            <div className="text-center sm:text-left">
              <p className="text-white font-bold text-lg mb-1" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                Butuh website atau aplikasi untuk bisnis Anda?
              </p>
              <p className="text-white/70 text-sm">Konsultasi gratis — harga menyesuaikan kebutuhan Anda.</p>
            </div>
            <a href="https://wa.me/6283898911244?text=Halo,%20saya%20ingin%20konsultasi%20pembuatan%20website"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm bg-white text-[#1D4ED8] hover:bg-[#EFF6FF] transition-colors flex-shrink-0 group">
              Chat WhatsApp
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>

          {/* Related */}
          <div className="mt-14 pt-8 border-t border-[#E2E8F0]">
            <h2 className="text-lg font-bold text-[#0F172A] mb-5" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Artikel Lainnya</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {related.map((r) => (
                <Link key={r.slug} to={`/blog/${r.slug}`} className="warm-card p-5 group block">
                  <p className="text-[10px] text-[#475569] mb-2">{r.category} · {r.readTime}</p>
                  <p className="font-bold text-sm text-[#0F172A] group-hover:text-[#1D4ED8] transition-colors mb-2">{r.title}</p>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[#1D4ED8]">
                    Baca artikel <ArrowUpRight size={10} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </motion.article>
      </main>
    </div>
  );
}

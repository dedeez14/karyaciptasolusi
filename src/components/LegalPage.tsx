import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { CalendarClock, ArrowUpRight } from 'lucide-react';
import SubPageHeader from './SubPageHeader';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface LegalPageProps {
  title: string;
  intro: string;
  updatedAt: string;
  sections: LegalSection[];
  children?: React.ReactNode;
  footerNote?: string;
}

export default function LegalPage({
  title,
  intro,
  updatedAt,
  sections,
  children,
  footerNote,
}: LegalPageProps) {
  return (
    <div className="min-h-[100dvh] bg-white">
      <SubPageHeader subtitle="Informasi Legal" />

      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0F4C81, #1D4ED8)' }}>
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{ backgroundImage: 'radial-gradient(circle, #fff 1.5px, transparent 1.5px)', backgroundSize: '30px 30px' }}
        />
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-16 relative z-10">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: easing }}>
            <nav aria-label="Breadcrumb" className="mb-4">
              <ol className="flex flex-wrap items-center gap-1.5 text-xs text-white/70">
                <li><Link to="/" className="hover:text-white transition-colors">Beranda</Link></li>
                <li aria-hidden="true">/</li>
                <li className="text-white font-medium">{title}</li>
              </ol>
            </nav>
            <h1
              className="text-3xl lg:text-[2.4rem] font-bold text-white leading-tight mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {title}
            </h1>
            <p className="text-white/80 text-[15px] leading-relaxed max-w-2xl mb-5">{intro}</p>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-sm text-white text-xs font-medium">
              <CalendarClock size={13} /> Terakhir diperbarui: {updatedAt}
            </span>
          </motion.div>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        {children}

        {sections.map((s, i) => (
          <motion.section
            key={s.heading}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.03, ease: easing }}
            className="mb-9"
          >
            <h2
              className="text-xl lg:text-[22px] font-bold text-[#0F172A] mb-3"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {s.heading}
            </h2>
            {s.paragraphs?.map((p) => (
              <p key={p} className="text-[16px] text-[#334155] leading-[1.8] mb-3">
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul className="space-y-2.5 mt-3">
                {s.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3 text-[16px] text-[#334155] leading-[1.75]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] mt-2.5 flex-shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        ))}

        {footerNote && (
          <p className="text-[13px] text-[#475569]/80 leading-relaxed border-t border-[#E2E8F0] pt-6 mt-10">
            {footerNote}
          </p>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/" className="btn-secondary">
            Kembali ke Beranda
          </Link>
          <a
            href="https://wa.me/6283898911244?text=Halo,%20saya%20ingin%20bertanya%20soal%20kebijakan%20data"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Tanya via WhatsApp
            <ArrowUpRight size={15} />
          </a>
        </div>
      </main>
    </div>
  );
}

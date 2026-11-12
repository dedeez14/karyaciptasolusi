import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, MessageCircleQuestion, Search } from 'lucide-react';
import { useSite } from '../lib/siteContext';

export default function FAQSection() {
  const { site, waLink } = useSite();
  const faqs = site.faqs;
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [search, setSearch] = useState('');

  const filteredFaqs = useMemo(() => {
    if (!search.trim()) return faqs;
    const term = search.toLowerCase();
    return faqs.filter(f => f.q.toLowerCase().includes(term) || f.a.toLowerCase().includes(term));
  }, [search, faqs]);

  return (
    <section id="faq" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%)' }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-10">
          <span className="section-badge mb-3">FAQ</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Pertanyaan <span className="text-accent">Umum</span></h2>
        </motion.div>

        {/* Search */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="relative mb-8">
          <label htmlFor="faq-search" className="sr-only">Cari pertanyaan</label>
          <Search size={18} aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-[#475569]" />
          <input
            id="faq-search"
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari pertanyaan..."
            className="input-field pl-11"
          />
        </motion.div>

        {filteredFaqs.length === 0 && (
          <p className="text-center text-[#475569] text-sm py-8">Tidak ada hasil untuk &ldquo;{search}&rdquo;. Coba kata kunci lain.</p>
        )}

        <div className="space-y-3">
          {filteredFaqs.map((faq, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className={`rounded-xl border transition-all duration-300 overflow-hidden ${openIndex === i ? 'bg-white border-brand/20 border-l-gold border-l-[3px] shadow-md' : 'bg-white/60 border-[#E2E8F0]/50 hover:bg-white'}`}>
              <button onClick={() => setOpenIndex(openIndex === i ? null : i)} aria-expanded={openIndex === i} className="w-full min-h-[44px] flex items-center justify-between px-5 py-4 text-left rounded-xl">
                <div className="flex items-center gap-3 pr-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${openIndex === i ? 'bg-brand' : 'bg-brand-tint'}`}>
                    {openIndex === i ? <Minus size={14} className="text-white" /> : <Plus size={14} style={{ color: 'rgb(var(--brand))' }} />}
                  </div>
                  <span className={`font-semibold text-sm transition-colors ${openIndex === i ? 'text-brand' : 'text-[#0F172A]'}`}>{faq.q}</span>
                </div>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                    <div className="px-5 pb-4 pt-0">
                      <div className="border-t border-[#E2E8F0] pt-3 ml-11">
                        <p className="text-sm text-[#475569] leading-relaxed">{faq.a}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }} className="text-center mt-10">
          <p className="text-sm text-[#475569] mb-3">Masih punya pertanyaan?</p>
          <a href={waLink()} target="_blank" rel="noopener noreferrer"
            className="btn-primary inline-flex items-center gap-2">
            <MessageCircleQuestion size={16} /> Tanya via WhatsApp
          </a>
        </motion.div>
      </div>
    </section>
  );
}

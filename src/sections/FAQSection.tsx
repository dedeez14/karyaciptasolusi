import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Minus, MessageCircleQuestion, Search } from 'lucide-react';

const faqs = [
  { q: 'Layanan apa saja yang ditawarkan?', a: 'Kami menawarkan 5 layanan utama: Konsultasi IT, Jasa Pemrograman & Pengembangan Aplikasi, Penerbitan Software, Platform Digital & SaaS, serta Layanan Pengolahan Data dan Hosting.' },
  { q: 'Berapa lama waktu pengerjaan proyek?', a: 'Aplikasi sederhana memakan waktu 2-4 minggu, proyek kompleks 2-3 bulan. Kami berikan estimasi setelah diskusi kebutuhan.' },
  { q: 'Apakah menerima proyek dari luar Depok?', a: 'Tentu! Kami melayani klien dari seluruh Indonesia. Proses development secara remote, komunikasi via video call/email/WhatsApp.' },
  { q: 'Bagaimana sistem pembayarannya?', a: 'Sistem bertahap: 30% DP, 40% di tengah proyek (demo/MVP), 30% sisanya setelah proyek selesai di-deploy.' },
  { q: 'Apakah ada garansi setelah proyek selesai?', a: 'Ya, garansi bug fixing 1 bulan setelah deploy. Tersedia juga paket maintenance bulanan.' },
  { q: 'Bisa konsultasi dulu sebelum memutuskan?', a: 'Tentu! Kami menyediakan konsultasi gratis. Hubungi kami via WhatsApp atau telepon.' },
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [search, setSearch] = useState('');

  const filteredFaqs = useMemo(() => {
    if (!search.trim()) return faqs;
    const term = search.toLowerCase();
    return faqs.filter(f => f.q.toLowerCase().includes(term) || f.a.toLowerCase().includes(term));
  }, [search]);

  return (
    <section id="faq" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #FFFBF3 0%, #FFFFFF 100%)' }}>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-10">
          <span className="section-badge mb-3">FAQ</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Pertanyaan <span className="text-[#0F4C81]">Umum</span></h2>
        </motion.div>

        {/* Search */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="relative mb-8">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B6B7B]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari pertanyaan..."
            className="input-field pl-11"
          />
        </motion.div>

        {filteredFaqs.length === 0 && (
          <p className="text-center text-[#6B6B7B] text-sm py-8">Tidak ada hasil untuk &ldquo;{search}&rdquo;. Coba kata kunci lain.</p>
        )}

        <div className="space-y-3">
          {filteredFaqs.map((faq, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className={`rounded-xl border transition-all duration-300 overflow-hidden ${openIndex === i ? 'bg-white border-[#F4B942]/20 shadow-md' : 'bg-white/60 border-[#F0E6D3]/50 hover:bg-white'}`}>
              <button onClick={() => setOpenIndex(openIndex === i ? null : i)} className="w-full flex items-center justify-between px-5 py-4 text-left">
                <div className="flex items-center gap-3 pr-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${openIndex === i ? 'bg-[#F4B942]' : 'bg-[#FFF8E7]'}`}>
                    {openIndex === i ? <Minus size={14} className="text-white" /> : <Plus size={14} style={{ color: '#D4941A' }} />}
                  </div>
                  <span className={`font-semibold text-sm transition-colors ${openIndex === i ? 'text-[#D4941A]' : 'text-[#2D2D3A]'}`}>{faq.q}</span>
                </div>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden">
                    <div className="px-5 pb-4 pt-0">
                      <div className="border-t border-[#F0E6D3] pt-3 ml-11">
                        <p className="text-sm text-[#6B6B7B] leading-relaxed">{faq.a}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }} className="text-center mt-10">
          <p className="text-sm text-[#6B6B7B] mb-3">Masih punya pertanyaan?</p>
          <a href="https://wa.me/6285601771312" target="_blank" rel="noopener noreferrer"
            className="btn-primary inline-flex items-center gap-2">
            <MessageCircleQuestion size={16} /> Tanya via WhatsApp
          </a>
        </motion.div>
      </div>
    </section>
  );
}

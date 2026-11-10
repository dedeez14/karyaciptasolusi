import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Receipt, ArrowLeft, Printer, ArrowRight, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import InvoiceGenerator from './tools/InvoiceGenerator';
import KwitansiGenerator from './tools/KwitansiGenerator';
import SuratPenawaranGenerator from './tools/SuratPenawaranGenerator';
import SuratKontrakGenerator from './tools/SuratKontrakGenerator';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const tools = [
  {
    id: 'invoice',
    label: 'Invoice',
    icon: FileText,
    desc: 'Generate invoice profesional dengan format rapi dan otomatis.',
    gradient: 'from-[#2563EB] via-[#60A5FA] to-[#1D4ED8]',
    shadowColor: 'rgba(37, 99, 235, 0.25)',
  },
  {
    id: 'kwitansi',
    label: 'Kwitansi',
    icon: Receipt,
    desc: 'Generate kwitansi pembayaran yang valid dan terstruktur.',
    gradient: 'from-[#0F4C81] via-[#1565A0] to-[#1E6BAF]',
    shadowColor: 'rgba(15, 76, 129, 0.25)',
  },
  {
    id: 'penawaran',
    label: 'Surat Penawaran',
    icon: FileSpreadsheet,
    desc: 'Generate surat penawaran harga untuk klien Anda.',
    gradient: 'from-[#1E6BAF] via-[#2980B9] to-[#0F4C81]',
    shadowColor: 'rgba(30, 107, 175, 0.25)',
  },
  {
    id: 'kontrak',
    label: 'Surat Perjanjian',
    icon: ShieldCheck,
    desc: 'Generate draft perjanjian kerja yang profesional.',
    gradient: 'from-[#1D4ED8] via-[#1E40AF] to-[#0F4C81]',
    shadowColor: 'rgba(29, 78, 216, 0.25)',
  },
];

export default function Tools() {
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const renderTool = () => {
    switch (activeTool) {
      case 'invoice': return <InvoiceGenerator />;
      case 'kwitansi': return <KwitansiGenerator />;
      case 'penawaran': return <SuratPenawaranGenerator />;
      case 'kontrak': return <SuratKontrakGenerator />;
      default: return null;
    }
  };

  const activeToolData = tools.find((t) => t.id === activeTool);

  return (
    <div className="min-h-screen bg-[#F8FAFC]" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* ─── Header ─── */}
      <div className="bg-white/80 backdrop-blur-md border-b border-[#E2E8F0] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AnimatePresence mode="wait">
              {activeTool && (
                <motion.button
                  key="back"
                  initial={{ opacity: 0, x: -10, scale: 0.8 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -10, scale: 0.8 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setActiveTool(null)}
                  whileHover={{ scale: 1.08, backgroundColor: '#DBEAFE' }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2 rounded-xl transition-colors"
                >
                  <ArrowLeft size={20} className="text-[#0F172A]" />
                </motion.button>
              )}
            </AnimatePresence>

            <motion.div
              layout
              className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0"
            >
              <img src="/images/logo-main.png?v=2" alt="KCS" className="w-full h-full object-contain rounded" />
            </motion.div>

            <motion.div layout className="overflow-hidden">
              <AnimatePresence mode="wait">
                <motion.h1
                  key={activeTool || 'title'}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                  className="text-sm font-bold text-[#0F172A] whitespace-nowrap"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  {activeTool ? activeToolData?.label : 'Generator Dokumen'}
                </motion.h1>
              </AnimatePresence>
              {!activeTool && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[10px] text-[#475569]"
                >
                  PT Karya Cipta Solusi
                </motion.p>
              )}
            </motion.div>
          </div>

          <AnimatePresence>
            {activeTool && (
              <motion.div
                key="print-btn"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
              >
                <motion.button
                  onClick={() => window.print()}
                  whileHover={{ y: -2 }}
                  whileTap={{ y: 0 }}
                  className="btn-primary btn-small gap-1.5"
                >
                  <Printer size={14} />
                  Print / PDF
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ─── Main Content ─── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <AnimatePresence mode="wait">
          {!activeTool ? (
            <motion.div
              key="menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.35 }}
            >
              {/* Header text */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: easing }}
                className="text-center mb-12"
              >
                <span className="section-badge mb-4">Tools</span>
                <h2
                  className="text-3xl sm:text-4xl font-bold text-[#0F172A] mb-3"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  Pilih <span style={{ color: '#1D4ED8' }}>Generator</span>
                </h2>
                <p className="text-[#475569] text-sm max-w-md mx-auto leading-relaxed">
                  Buat invoice, kwitansi, dan surat-surat untuk PT Karya Cipta Solusi dengan cepat dan mudah.
                </p>
              </motion.div>

              {/* Tool Cards Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {tools.map((tool, i) => (
                  <motion.button
                    key={tool.id}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1, duration: 0.5, ease: easing }}
                    whileHover={{ y: -6, transition: { duration: 0.25 } }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setActiveTool(tool.id)}
                    className="warm-card p-8 text-left group relative overflow-hidden"
                  >
                    {/* Hover gradient background */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      whileHover={{ opacity: 1 }}
                      transition={{ duration: 0.35 }}
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: `linear-gradient(135deg, ${tool.shadowColor.replace('0.25', '0.06')}, transparent 60%)`,
                      }}
                    />

                    {/* Gradient icon container */}
                    <motion.div
                      whileHover={{ rotate: [0, -4, 4, 0], scale: 1.08 }}
                      transition={{ duration: 0.5, ease: 'easeInOut' }}
                      className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${tool.gradient} flex items-center justify-center mb-5 shadow-lg relative z-10`}
                      style={{ boxShadow: `0 8px 24px ${tool.shadowColor}` }}
                    >
                      <tool.icon size={28} className="text-white" />
                    </motion.div>

                    {/* Card text */}
                    <h3 className="font-bold text-[#0F172A] text-base mb-2 relative z-10 group-hover:text-[#1D4ED8] transition-colors duration-200">
                      {tool.label}
                    </h3>
                    <p className="text-xs text-[#475569] leading-relaxed mb-4 relative z-10">
                      {tool.desc}
                    </p>

                    {/* Hover "Buka Tool" text */}
                    <motion.div
                      initial={{ opacity: 0, x: -8 }}
                      whileHover={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-center gap-1 text-xs font-bold relative z-10"
                      style={{ color: '#1D4ED8' }}
                    >
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center gap-1">
                        Buka Tool <ArrowRight size={12} />
                      </span>
                    </motion.div>

                    {/* Corner accent */}
                    <div
                      className="absolute -bottom-6 -right-6 w-20 h-20 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                      style={{ background: tool.shadowColor.replace('0.25', '0.08') }}
                    />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="tool"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.4, ease: easing }}
            >
              {/* Tool header bar */}
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="flex items-center gap-3 mb-6"
              >
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${activeToolData?.gradient} flex items-center justify-center shadow-md`}
                  style={{ boxShadow: `0 4px 16px ${activeToolData?.shadowColor}` }}
                >
                  {activeToolData && <activeToolData.icon size={20} className="text-white" />}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#0F172A]">{activeToolData?.label}</h3>
                  <p className="text-xs text-[#475569]">{activeToolData?.desc}</p>
                </div>
              </motion.div>

              {renderTool()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

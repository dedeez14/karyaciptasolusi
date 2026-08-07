import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Code2, Server, ShoppingCart, Database, ExternalLink } from 'lucide-react';

const projects = [
  { id: 1, title: 'Sistem ERP UMKM', category: 'Web App', desc: 'Sistem manajemen bisnis terintegrasi untuk UMKM dengan modul keuangan, inventory, CRM, dan laporan otomatis.', tech: ['React', 'Node.js', 'PostgreSQL'], icon: Code2, color: 'from-[#2563EB] to-[#1D4ED8]', colorBright: 'from-[#60A5FA] to-[#2563EB]' },
  { id: 2, title: 'Platform E-Learning', category: 'SaaS', desc: 'Platform pembelajaran online lengkap dengan video conference, kuis interaktif, dan sertifikat digital.', tech: ['Next.js', 'AWS', 'MongoDB'], icon: Server, color: 'from-[#0F4C81] to-[#1E6BAF]', colorBright: 'from-[#1E6BAF] to-[#3B8ED0]' },
  { id: 3, title: 'E-Commerce Pro', category: 'Web App', desc: 'Toko online dengan payment gateway multi-bank, manajemen produk, dan sistem review pelanggan.', tech: ['Vue.js', 'Laravel', 'MySQL'], icon: ShoppingCart, color: 'from-[#1D4ED8] to-[#2563EB]', colorBright: 'from-[#2563EB] to-[#60A5FA]' },
  { id: 4, title: 'Sistem Info Desa', category: 'Data', desc: 'Aplikasi pengelolaan data administrasi desa dengan peta digital dan laporan kependudukan.', tech: ['React', 'Firebase'], icon: Database, color: 'from-[#1E6BAF] to-[#0F4C81]', colorBright: 'from-[#3B8ED0] to-[#1E6BAF]' },
];

const categories = ['Semua', 'Web App', 'SaaS', 'Data'];

const techBadgeColors: Record<string, string> = {
  'React': 'from-[#61DAFB] to-[#3BA9D0]',
  'Node.js': 'from-[#68A063] to-[#4A8C4A]',
  'PostgreSQL': 'from-[#336791] to-[#254E74]',
  'Next.js': 'from-[#0F172A] to-[#1A1A28]',
  'AWS': 'from-[#FF9900] to-[#E88B00]',
  'MongoDB': 'from-[#47A248] to-[#388E3F]',
  'Vue.js': 'from-[#42B883] to-[#369B6D]',
  'Laravel': 'from-[#FF2D20] to-[#E0251A]',
  'MySQL': 'from-[#00758F] to-[#005E73]',
  'Firebase': 'from-[#FFCA28] to-[#FFB300]',
};

/* Set ke true untuk menampilkan kembali section portofolio */
const SHOW_PORTFOLIO: boolean = false;

export default function PortfolioSection() {
  const [activeCategory, setActiveCategory] = useState('Semua');
  const [selectedProject, setSelectedProject] = useState<typeof projects[0] | null>(null);
  const filtered = activeCategory === 'Semua' ? projects : projects.filter((p) => p.category === activeCategory);

  if (!SHOW_PORTFOLIO) return null;

  return (
    <section id="portofolio" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #F8FAFC 0%, #EFF6FF 100%)' }}>
      {/* Floating decorative elements */}
      <motion.div
        animate={{ y: [0, -15, 0], rotate: [0, 5, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-20 left-10 w-20 h-20 rounded-full opacity-[0.04]"
        style={{ background: 'radial-gradient(circle, #2563EB, transparent 70%)' }}
      />
      <motion.div
        animate={{ y: [0, 12, 0], rotate: [0, -5, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="absolute bottom-32 right-16 w-32 h-32 rounded-full opacity-[0.05]"
        style={{ background: 'radial-gradient(circle, #0F4C81, transparent 70%)' }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-12"
        >
          <span className="section-badge mb-3 inline-block">Portofolio</span>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <motion.h2
              className="text-4xl lg:text-5xl font-bold text-[#0F172A]"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              Proyek <span style={{ color: '#1D4ED8' }}>Terbaru</span>
            </motion.h2>
            <motion.div
              className="flex flex-wrap gap-2"
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              {categories.map((cat) => (
                <motion.button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className={`btn-small transition-all duration-300 ${
                    activeCategory === cat ? 'btn-primary' : 'btn-secondary'
                  }`}
                >
                  {cat}
                </motion.button>
              ))}
            </motion.div>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          <AnimatePresence mode="popLayout">
            {filtered.map((project, i) => (
              <motion.div
                key={project.id}
                layout
                initial={{ opacity: 0, scale: 0.9, y: 30 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 30 }}
                transition={{ duration: 0.5, delay: i * 0.1, type: "spring", stiffness: 200, damping: 25 }}
                onClick={() => setSelectedProject(project)}
                whileHover={{ scale: 1.02, y: -4 }}
                className="group relative rounded-2xl overflow-hidden cursor-pointer bg-white border border-[#E2E8F0] hover:border-[#2563EB]/40 transition-colors duration-300 shadow-sm hover:shadow-xl hover:shadow-[#2563EB]/10"
              >
                {/* Gradient Top Half */}
                <div className="relative h-52 overflow-hidden">
                  <motion.div
                    className={`absolute inset-0 bg-gradient-to-br ${project.color}`}
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.4 }}
                  />
                  {/* Animated background pattern */}
                  <div className="absolute inset-0 opacity-10">
                    <div className="absolute top-4 left-4 w-16 h-16 border border-white/30 rounded-full" />
                    <div className="absolute bottom-6 right-8 w-24 h-24 border border-white/20 rounded-full" />
                    <div className="absolute top-10 right-12 w-8 h-8 border border-white/25 rounded-full" />
                  </div>

                  {/* Icon */}
                  <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    initial={{ scale: 1 }}
                    whileHover={{ scale: 1.1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center">
                      <project.icon size={40} className="text-white" />
                    </div>
                  </motion.div>

                  {/* Category badge */}
                  <div className="absolute top-4 left-4">
                    <span className="px-3 py-1 bg-white/15 backdrop-blur-md border border-white/20 rounded-full text-white text-[10px] font-semibold tracking-wider uppercase">
                      {project.category}
                    </span>
                  </div>

                  {/* "Lihat Detail" overlay on hover */}
                  <motion.div
                    className="absolute inset-0 bg-[#0F172A]/60 backdrop-blur-sm flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    whileHover={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <motion.div
                      className="flex items-center gap-2 px-5 py-2.5 bg-white rounded-full text-[#0F172A] text-sm font-semibold shadow-lg"
                      initial={{ y: 10, opacity: 0 }}
                      whileHover={{ y: 0, opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.1 }}
                    >
                      <ExternalLink size={14} />
                      Lihat Detail
                    </motion.div>
                  </motion.div>
                </div>

                {/* White Bottom Half */}
                <div className="p-6">
                  <h3 className="text-[#0F172A] font-bold text-lg mb-2 group-hover:text-[#1D4ED8] transition-colors duration-300">
                    {project.title}
                  </h3>
                  <p className="text-[#475569] text-sm mb-4 line-clamp-2 leading-relaxed">
                    {project.desc}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {project.tech.map((t) => (
                      <motion.span
                        key={t}
                        whileHover={{ scale: 1.1, y: -1 }}
                        className={`px-3 py-1 bg-gradient-to-r ${techBadgeColors[t] || 'from-[#2563EB] to-[#1D4ED8]'} text-white text-[10px] font-semibold rounded-full shadow-sm`}
                      >
                        {t}
                      </motion.span>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selectedProject && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedProject(null)}
          >
            {/* Backdrop with blur */}
            <motion.div
              className="absolute inset-0 bg-[#0F172A]/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 40 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="bg-white rounded-3xl max-w-lg w-full overflow-hidden border border-[#E2E8F0] shadow-2xl relative z-10"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Gradient Header */}
              <div className={`relative h-56 bg-gradient-to-br ${selectedProject.color} overflow-hidden`}>
                {/* Decorative circles */}
                <div className="absolute inset-0">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1], opacity: [0.1, 0.15, 0.1] }}
                    transition={{ duration: 6, repeat: Infinity }}
                    className="absolute -top-10 -right-10 w-40 h-40 border border-white/20 rounded-full"
                  />
                  <motion.div
                    animate={{ scale: [1.1, 1, 1.1], opacity: [0.08, 0.12, 0.08] }}
                    transition={{ duration: 8, repeat: Infinity }}
                    className="absolute -bottom-8 -left-8 w-32 h-32 border border-white/15 rounded-full"
                  />
                </div>

                {/* Close button */}
                <motion.button
                  onClick={() => setSelectedProject(null)}
                  className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors z-20"
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                >
                  <X size={18} />
                </motion.button>

                {/* Large Icon */}
                <motion.div
                  className="absolute inset-0 flex items-center justify-center"
                  initial={{ scale: 0, rotate: -20 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                >
                  <div className="w-24 h-24 rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-lg">
                    <selectedProject.icon size={52} className="text-white" />
                  </div>
                </motion.div>

                {/* Category badge */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <span className="px-4 py-1.5 bg-white/15 backdrop-blur-md border border-white/20 rounded-full text-white text-[11px] font-semibold tracking-wider uppercase">
                    {selectedProject.category}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="p-8">
                <motion.h3
                  className="text-[#0F172A] font-bold text-2xl mb-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  {selectedProject.title}
                </motion.h3>
                <motion.p
                  className="text-[#475569] text-sm mb-6 leading-relaxed"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  {selectedProject.desc}
                </motion.p>

                {/* Tech Stack */}
                <motion.div
                  className="mb-8"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <p className="text-[#0F172A] text-xs font-semibold uppercase tracking-wider mb-3">Tech Stack</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedProject.tech.map((t, i) => (
                      <motion.span
                        key={t}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.3 + i * 0.08, type: "spring", stiffness: 300 }}
                        whileHover={{ scale: 1.1, y: -2 }}
                        className={`px-4 py-1.5 bg-gradient-to-r ${techBadgeColors[t] || 'from-[#2563EB] to-[#1D4ED8]'} text-white text-xs font-semibold rounded-full shadow-md`}
                      >
                        {t}
                      </motion.span>
                    ))}
                  </div>
                </motion.div>

                {/* CTA Buttons */}
                <motion.div
                  className="flex gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 }}
                >
                  <motion.a
                    href="https://wa.me/6282298853966"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 btn-primary text-center text-sm"
                    whileHover={{ scale: 1.02, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Hubungi Kami
                  </motion.a>
                  <motion.button
                    onClick={() => setSelectedProject(null)}
                    className="btn-secondary px-6"
                    whileHover={{ scale: 1.02, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Tutup
                  </motion.button>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

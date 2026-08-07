import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, ChevronLeft, ChevronRight, Quote } from 'lucide-react';

const testimonials = [
  { id: 1, name: 'Budi Santoso', role: 'Owner, Toko Serba Ada', content: 'KCS membantu kami membuat sistem POS yang sangat membantu operasional toko. Pelayanan cepat dan hasilnya memuaskan. Timnya sangat responsif terhadap setiap request perubahan.', rating: 5 },
  { id: 2, name: 'Siti Rahayu', role: 'Manager, Lembaga Bimbel Cerdas', content: 'Platform e-learning yang dibuat sangat user-friendly. Siswa dan guru kami sangat terbantu dengan fitur yang lengkap. Proses development juga transparan dari awal sampai akhir.', rating: 5 },
  { id: 3, name: 'Andi Wijaya', role: 'Direktur, PT Sejahtera Abadi', content: 'Konsultasi IT dari KCS sangat profesional. Mereka menganalisis kebutuhan kami dengan baik dan memberikan solusi tepat sasaran. Hasilnya melebihi ekspektasi kami.', rating: 5 },
  { id: 4, name: 'Dewi Kusuma', role: 'Kepala Desa Digital', content: 'Sistem informasi desa yang dikembangkan sangat membantu administrasi kami. Data tersusun rapi dan mudah diakses. Warga desa juga sangat terbantu dengan layanan digital ini.', rating: 5 },
  { id: 5, name: 'Rudi Hartono', role: 'Founder, Startup Agritech Nusantara', content: 'KCS built our entire SaaS platform from scratch dengan kualitas yang luar biasa. Mereka tidak hanya mengikuti spesifikasi, tapi juga memberikan banyak saran improvement yang sangat berharga.', rating: 5 },
  { id: 6, name: 'Maya Indah', role: 'Operations Manager, Logistik Express', content: 'Sistem tracking dan manajemen pengiriman yang dibuat KCS meningkatkan efisiensi operasional kami hingga 40%. Dashboard analytics-nya sangat informatif dan mudah dipahami.', rating: 5 },
];

const avatarGradients = [
  'from-[#2563EB] to-[#1D4ED8]',
  'from-[#0F4C81] to-[#1E6BAF]',
  'from-[#1D4ED8] to-[#2563EB]',
  'from-[#1E6BAF] to-[#3B8ED0]',
  'from-[#E85D4A] to-[#C94A38]',
  'from-[#47A248] to-[#388E3F]',
];

export default function TestimonialsSection() {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const paginate = useCallback((newDirection: number) => {
    setDirection(newDirection);
    setCurrent((prev) => (prev + newDirection + testimonials.length) % testimonials.length);
  }, []);

  // Auto-rotate with pause on hover
  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(() => paginate(1), 6000);
    return () => clearInterval(timer);
  }, [paginate, isPaused]);

  const t = testimonials[current];

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 120 : -120,
      opacity: 0,
      scale: 0.95,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 120 : -120,
      opacity: 0,
      scale: 0.95,
    }),
  };

  return (
    <section id="testimoni" className="relative py-24 lg:py-32 overflow-hidden bg-white">
      {/* Decorative floating elements */}
      <motion.div
        animate={{ y: [0, -20, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-40"
        style={{ background: 'radial-gradient(circle, #2563EB08, transparent 70%)' }}
      />
      <motion.div
        animate={{ y: [0, 15, 0], scale: [1, 1.03, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        className="absolute bottom-0 left-0 w-72 h-72 rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #0F4C8106, transparent 70%)' }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <motion.span
            className="section-badge mb-3 inline-block"
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
          >
            Testimoni
          </motion.span>
          <motion.h2
            className="text-4xl lg:text-5xl font-bold text-[#0F172A]"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            Apa Kata <span style={{ color: '#1D4ED8' }}>Klien</span>
          </motion.h2>
        </motion.div>

        {/* Glassmorphism Card */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative rounded-3xl p-8 lg:p-14 border border-[#E2E8F0]/80 overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #F8FAFC 0%, #EFF6FF 50%, #DBEAFE 100%)',
            boxShadow: '0 8px 40px rgba(37, 99, 235, 0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
          }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          ref={containerRef}
        >
          {/* Subtle glassmorphism overlay */}
          <div className="absolute inset-0 bg-white/20 backdrop-blur-[1px] pointer-events-none" />

          {/* Decorative quote marks */}
          <motion.div
            animate={{ rotate: [0, 2, 0], scale: [1, 1.02, 1] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          >
            <Quote
              size={120}
              className="absolute top-4 left-6 lg:top-6 lg:left-10 text-[#2563EB] pointer-events-none select-none"
              style={{ opacity: 0.06 }}
              strokeWidth={1}
            />
          </motion.div>
          <motion.div
            animate={{ rotate: [0, -2, 0], scale: [1, 1.02, 1] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 4 }}
          >
            <Quote
              size={80}
              className="absolute bottom-20 right-8 text-[#0F4C81] pointer-events-none select-none rotate-180"
              style={{ opacity: 0.04 }}
              strokeWidth={1}
            />
          </motion.div>

          {/* Main content */}
          <div className="relative min-h-[260px] flex flex-col items-center justify-center text-center pt-4">
            <AnimatePresence custom={direction} mode="wait">
              <motion.div
                key={t.id}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="flex flex-col items-center w-full"
              >
                {/* Star Rating - Animated */}
                <div className="flex gap-1.5 mb-6">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, scale: 0, rotate: -180 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      transition={{
                        delay: 0.1 + i * 0.1,
                        type: "spring",
                        stiffness: 400,
                        damping: 15,
                      }}
                    >
                      <Star
                        size={22}
                        className="fill-[#2563EB] text-[#2563EB] drop-shadow-sm"
                      />
                    </motion.div>
                  ))}
                </div>

                {/* Testimonial Text */}
                <motion.p
                  className="text-lg lg:text-xl text-[#0F172A]/85 leading-[1.75] max-w-2xl mb-10 italic font-medium"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  &ldquo;{t.content}&rdquo;
                </motion.p>

                {/* Author Card */}
                <motion.div
                  className="flex items-center gap-4"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
                >
                  {/* Gradient Avatar */}
                  <motion.div
                    className={`w-14 h-14 rounded-full bg-gradient-to-br ${avatarGradients[current]} flex items-center justify-center text-white font-bold text-xl shadow-lg`}
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 300 }}
                  >
                    {t.name.charAt(0)}
                  </motion.div>

                  <div className="text-left">
                    <p className="font-bold text-[#0F172A] text-base">{t.name}</p>
                    {/* Role Badge */}
                    <span className="inline-block mt-0.5 px-3 py-0.5 bg-[#2563EB]/10 border border-[#2563EB]/20 rounded-full text-[#1D4ED8] text-[11px] font-semibold">
                      {t.role}
                    </span>
                  </div>
                </motion.div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <motion.div
            className="flex items-center justify-center gap-5 mt-10 relative z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {/* Previous Button */}
            <motion.button
              onClick={() => paginate(-1)}
              className="w-12 h-12 rounded-full btn-secondary flex items-center justify-center"
              whileHover={{ scale: 1.1, x: -2 }}
              whileTap={{ scale: 0.9 }}
              aria-label="Testimoni sebelumnya"
            >
              <ChevronLeft size={18} />
            </motion.button>

            {/* Dot Indicators */}
            <div className="flex gap-2 items-center">
              {testimonials.map((_, i) => (
                <motion.button
                  key={i}
                  onClick={() => {
                    setDirection(i > current ? 1 : -1);
                    setCurrent(i);
                  }}
                  className={`h-2.5 rounded-full transition-all duration-500 ${
                    i === current
                      ? 'w-8 bg-gradient-to-r from-[#2563EB] to-[#1D4ED8]'
                      : 'w-2.5 bg-[#E2E8F0] hover:bg-[#2563EB]/50'
                  }`}
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  aria-label={`Testimoni ${i + 1}`}
                />
              ))}
            </div>

            {/* Next Button */}
            <motion.button
              onClick={() => paginate(1)}
              className="w-12 h-12 rounded-full btn-secondary flex items-center justify-center"
              whileHover={{ scale: 1.1, x: 2 }}
              whileTap={{ scale: 0.9 }}
              aria-label="Testimoni selanjutnya"
            >
              <ChevronRight size={18} />
            </motion.button>
          </motion.div>

          {/* Pause indicator */}
          <AnimatePresence>
            {isPaused && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="absolute bottom-3 left-1/2 -translate-x-1/2"
              >
                <span className="text-[10px] text-[#94A3B8] font-medium tracking-wide uppercase">
                  Auto-rotate dijeda
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}

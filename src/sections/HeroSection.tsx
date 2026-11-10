import { motion } from 'framer-motion';
import { ArrowDownRight, Phone, Sparkles, Shield, MessageCircle, Headphones } from 'lucide-react';
import { useTypingEffect } from '../hooks/useTypingEffect';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

/* Floating dot configuration */
const floatingDots = [
  { size: 8, left: '8%', top: '18%', delay: 0, duration: 4, opacity: 0.25 },
  { size: 6, left: '22%', top: '35%', delay: 0.5, duration: 5, opacity: 0.18 },
  { size: 12, left: '15%', top: '65%', delay: 1, duration: 6, opacity: 0.12 },
  { size: 5, left: '55%', top: '12%', delay: 1.5, duration: 4.5, opacity: 0.2 },
  { size: 10, left: '75%', top: '25%', delay: 0.8, duration: 5.5, opacity: 0.15 },
  { size: 7, left: '85%', top: '55%', delay: 2, duration: 4, opacity: 0.22 },
  { size: 4, left: '45%', top: '80%', delay: 1.2, duration: 6, opacity: 0.18 },
  { size: 9, left: '65%', top: '75%', delay: 0.3, duration: 5, opacity: 0.14 },
];

/* Trust badges with icons */
const trustBadges = [
  { text: 'Badan Usaha Resmi', color: '#4ADE80', icon: Shield },
  { text: 'Konsultasi Gratis', color: '#2563EB', icon: MessageCircle },
  { text: 'Support 24/7', color: '#0F4C81', icon: Headphones },
];

/* Animation variants */
const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.2,
    },
  },
};

const lineVariants = {
  hidden: { opacity: 0, y: 28, rotateX: -35 },
  visible: {
    opacity: 1,
    y: 0,
    rotateX: 0,
    transition: { duration: 0.7, ease: easing },
  },
};

export default function HeroSection() {
  const typedText = useTypingEffect(
    ['Website Company Profile', 'Toko Online & E-Commerce', 'Aplikasi Web & Mobile Custom', 'Konsultasi IT Profesional', 'Platform SaaS Terintegrasi'],
    80, 40, 2500
  );

  return (
    <section
      id="beranda"
      className="relative min-h-[100dvh] overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #F8FAFC 0%, #FFFFFF 40%, #EFF6FF 70%, #DBEAFE 100%)',
      }}
    >
      {/* Background pattern image */}
      <div className="absolute inset-0 opacity-[0.08]">
        <img
          src="/images/banner-light.jpg"
          alt=""
          className="w-full h-full object-cover"
        />
      </div>

      {/* Subtle yellow blobs */}
      <div
        className="absolute top-20 right-[10%] w-64 h-64 rounded-full opacity-30"
        style={{ background: 'radial-gradient(circle, #2563EB20, transparent 70%)' }}
      />
      <div
        className="absolute bottom-40 left-[5%] w-80 h-80 rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #2563EB15, transparent 70%)' }}
      />

      {/* Floating animated dots */}
      {floatingDots.map((dot, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: dot.size,
            height: dot.size,
            left: dot.left,
            top: dot.top,
            background: `radial-gradient(circle, rgba(37,99,235,${dot.opacity * 2}), rgba(37,99,235,${dot.opacity}))`,
            boxShadow: `0 0 ${dot.size * 2}px rgba(37,99,235,${dot.opacity * 0.5})`,
          }}
          animate={{ y: [0, -15, 0] }}
          transition={{
            duration: dot.duration,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: dot.delay,
          }}
        />
      ))}

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[100dvh] flex items-center">
        <div className="grid lg:grid-cols-12 gap-8 w-full items-center py-24">
          {/* Left - Text content */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 1, ease: easing }}
            className="lg:col-span-7"
          >
            {/* Enhanced badge with shimmer */}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: easing }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#2563EB]/30 bg-[#2563EB]/8 mb-6 relative overflow-hidden"
            >
              {/* Shimmer overlay */}
              <motion.div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(37,99,235,0.15) 50%, transparent 100%)',
                }}
                animate={{ x: ['-100%', '200%'] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
              />
              <motion.div
                animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkles size={14} className="text-[#1D4ED8]" />
              </motion.div>
              <span className="text-[#1D4ED8] text-xs font-bold tracking-[0.15em] uppercase relative z-10">
                Solusi Teknologi Terpercaya
              </span>
            </motion.div>

            {/* Staggered text reveal h1 */}
            <motion.h1
              className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-[1.05] mb-4"
              style={{ fontFamily: "'Space Grotesk', sans-serif", perspective: '800px' }}
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <motion.span
                variants={lineVariants}
                className="block text-[#0F172A]"
              >
                Jasa Pembuatan
              </motion.span>
              <motion.span variants={lineVariants} className="block">
                <span style={{ color: '#1D4ED8' }}>Website</span>
                <span className="text-[#0F172A]"> &amp;</span>
              </motion.span>
              <motion.span variants={lineVariants} className="block text-[#0F172A]">
                Aplikasi untuk
              </motion.span>
              <motion.span variants={lineVariants} className="block">
                <span className="bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] bg-clip-text text-transparent">
                  Bisnis Anda.
                </span>
              </motion.span>
            </motion.h1>

            {/* Typing effect */}
            <div className="h-8 mb-5">
              <span
                className="text-lg sm:text-xl font-medium typing-cursor"
                style={{ color: '#1D4ED8' }}
              >
                {typedText}
              </span>
            </div>

            <p className="text-[#475569] max-w-lg mb-8 leading-relaxed text-sm">
              PT Karya Cipta Solusi adalah partner transformasi digital Anda jasa pembuatan website
              company profile, toko online, aplikasi custom, hingga konsultasi IT untuk mempercepat
              pertumbuhan bisnis Anda.
            </p>

            {/* CTA buttons with hover scale */}
            <div className="flex flex-wrap gap-3">
              <motion.a
                href="https://wa.me/6283898911244"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary group"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                Mulai Proyek{' '}
                <ArrowDownRight
                  size={18}
                  className="group-hover:translate-x-0.5 group-hover:translate-y-0.5 transition-transform"
                />
              </motion.a>
              <motion.a
                href="tel:083898911244"
                className="btn-secondary"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Phone size={16} /> 0838-9891-1244
              </motion.a>
            </div>

            {/* Trust badges row with icons */}
            <motion.div
              className="flex flex-wrap items-center gap-5 mt-8 pt-6"
              style={{ borderTop: '1px solid #E2E8F0' }}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.5, ease: easing }}
            >
              {trustBadges.map((badge) => (
                <motion.div
                  key={badge.text}
                  className="flex items-center gap-2"
                  whileHover={{ scale: 1.05, x: 3 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                >
                  <motion.span
                    className="w-2 h-2 rounded-full"
                    style={{ background: badge.color }}
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <badge.icon size={13} style={{ color: badge.color }} />
                  <span className="text-xs text-[#475569] font-medium">{badge.text}</span>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right - Logo visual */}
          <motion.div
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 0.4, duration: 1, ease: easing }}
            className="lg:col-span-5 hidden lg:flex justify-center"
          >
            <div className="relative">
              {/* Pulse ring behind illustration */}
              <motion.div
                className="absolute -inset-12 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(37,99,235,0.12) 0%, transparent 70%)',
                }}
                animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              />
              {/* Secondary pulse ring */}
              <motion.div
                className="absolute -inset-20 rounded-full border border-[#2563EB]/10"
                animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.5, 0.2] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
              />
              <div
                className="absolute -inset-10 rounded-full opacity-20"
                style={{
                  background:
                    'radial-gradient(circle, #2563EB30, transparent 70%)',
                }}
              />
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                className="relative"
              >
                <img
                  src="/images/hero-typing.png"
                  alt="Jasa pembuatan website dan aplikasi - PT Karya Cipta Solusi"
                  className="w-full max-w-md h-auto object-contain drop-shadow-xl rounded-2xl"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '/images/hero-main.png';
                  }}
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.2, duration: 0.5 }}
                whileHover={{ scale: 1.05, y: -3 }}
                className="absolute -bottom-2 -left-4 bg-white rounded-xl p-3 shadow-lg border border-[#E2E8F0] cursor-default"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                    style={{
                      background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                    }}
                  >
                    5+
                  </div>
                  <div>
                    <p className="text-[10px] text-[#475569]">Layanan</p>
                    <p className="text-xs font-bold text-[#0F172A]">Bidang Utama</p>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom wave */}
      <div className="absolute bottom-0 left-0 right-0 z-10">
        <svg viewBox="0 0 1440 60" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
          <path d="M0 60L1440 0V60H0Z" fill="white" />
        </svg>
      </div>
    </section>
  );
}

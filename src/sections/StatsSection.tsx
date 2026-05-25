import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import { Briefcase, Code, Users, Calendar, Plus } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const stats = [
  {
    icon: Briefcase,
    value: 5,
    prefix: '',
    suffix: '',
    label: 'Bidang',
    sub: 'Layanan Utama',
    accent: 'from-[#F4B942] to-[#D4941A]',
    borderAccent: '#F4B942',
    topBorder: 'linear-gradient(90deg, #F4B942, #D4941A)',
    iconBg: 'linear-gradient(135deg, #F4B942, #D4941A)',
  },
  {
    icon: Code,
    value: 50,
    prefix: '',
    suffix: '+',
    label: 'Proyek',
    sub: 'Terselesaikan',
    accent: 'from-[#0F4C81] to-[#1E6BAF]',
    borderAccent: '#0F4C81',
    topBorder: 'linear-gradient(90deg, #0F4C81, #1E6BAF)',
    iconBg: 'linear-gradient(135deg, #0F4C81, #1E6BAF)',
  },
  {
    icon: Users,
    value: 30,
    prefix: '',
    suffix: '+',
    label: 'Klien',
    sub: 'Terpercaya',
    accent: 'from-[#D4941A] to-[#F4B942]',
    borderAccent: '#D4941A',
    topBorder: 'linear-gradient(90deg, #D4941A, #F4B942)',
    iconBg: 'linear-gradient(135deg, #D4941A, #F4B942)',
  },
  {
    icon: Calendar,
    value: 1,
    prefix: '',
    suffix: '+',
    label: 'Tahun',
    sub: 'Pengalaman',
    accent: 'from-[#1E6BAF] to-[#0F4C81]',
    borderAccent: '#1E6BAF',
    topBorder: 'linear-gradient(90deg, #1E6BAF, #0F4C81)',
    iconBg: 'linear-gradient(135deg, #1E6BAF, #0F4C81)',
  },
];

/* Suffix pulse animation component */
function PulsingSuffix({ color, delay }: { color: string; delay: number }) {
  return (
    <motion.span
      className="inline-block ml-0.5"
      style={{ color }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: 0.4, ease: easing }}
    >
      <motion.span
        animate={{ scale: [1, 1.35, 1], opacity: [1, 0.7, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.3 }}
        className="inline-block"
      >
        <Plus size={28} strokeWidth={3} className="inline -mt-1" />
      </motion.span>
    </motion.span>
  );
}

export default function StatsSection() {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="relative py-20 bg-white overflow-hidden" ref={ref}>
      {/* Subtle dot pattern background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, #F4B942 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.06,
        }}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-6">
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.12, ease: easing }}
              whileHover={{
                y: -8,
                transition: { duration: 0.3, ease: easing },
              }}
              className="warm-card relative bg-white rounded-2xl p-6 overflow-hidden group cursor-default"
              style={{
                border: `1px solid ${stat.borderAccent}18`,
                boxShadow: `0 1px 3px ${stat.borderAccent}10, 0 4px 16px ${stat.borderAccent}08`,
              }}
            >
              {/* Gradient accent top border */}
              <div
                className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
                style={{ background: stat.topBorder }}
              />

              {/* Hover glow effect */}
              <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, ${stat.borderAccent}12 0%, transparent 70%)`,
                }}
              />

              {/* Large background watermark number */}
              <span
                className="absolute -right-2 -bottom-4 text-7xl font-bold text-[#F4B942]/[0.04] select-none group-hover:text-[#F4B942]/[0.08] transition-colors duration-500"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {stat.value}
              </span>

              <div className="relative z-10">
                {/* Rotating icon container */}
                <motion.div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: stat.iconBg }}
                  whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1 }}
                  transition={{ duration: 0.5, ease: easing }}
                >
                  <stat.icon size={22} className="text-white" />
                </motion.div>

                {/* Number with CountUp and pulsing suffix */}
                <div className="flex items-center mb-1">
                  <span
                    className="text-3xl lg:text-4xl font-bold text-[#2D2D3A]"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {inView ? (
                      <CountUp
                        start={0}
                        end={stat.value}
                        prefix={stat.prefix}
                        suffix={stat.suffix}
                        duration={2.5}
                      />
                    ) : (
                      `${stat.prefix}0${stat.suffix}`
                    )}
                  </span>
                  {/* Show pulsing "+" for stats that have suffix */}
                  {stat.suffix === '+' && inView && (
                    <PulsingSuffix color={stat.borderAccent} delay={i * 0.12 + 2.5} />
                  )}
                </div>

                <p className="text-[#2D2D3A] font-semibold text-sm">
                  {stat.label}
                </p>
                <p className="text-[#6B6B7B] text-xs mt-0.5">{stat.sub}</p>
              </div>

              {/* Bottom gradient line on hover */}
              <motion.div
                className="absolute bottom-0 left-4 right-4 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: stat.topBorder }}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

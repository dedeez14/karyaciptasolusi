import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import { BarChart3, Plus } from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { iconFor } from '../lib/icons';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

/* Palet kartu bergiliran (navy family; aksen gold pada garis atas kartu pertama & ketiga) */
const palettes = [
  { rgb: 'var(--brand)', top: 'linear-gradient(90deg, rgb(var(--brand)), rgb(var(--gold)))', iconBg: 'linear-gradient(135deg, rgb(var(--brand)), rgb(var(--brand-dark)))' },
  { rgb: 'var(--brand-dark)', top: 'linear-gradient(90deg, rgb(var(--brand-dark)), rgb(var(--brand-light)))', iconBg: 'linear-gradient(135deg, rgb(var(--brand-dark)), rgb(var(--brand-light)))' },
  { rgb: 'var(--brand-light)', top: 'linear-gradient(90deg, rgb(var(--brand-light)), rgb(var(--gold)))', iconBg: 'linear-gradient(135deg, rgb(var(--brand-light)), rgb(var(--brand)))' },
  { rgb: 'var(--brand-darker)', top: 'linear-gradient(90deg, rgb(var(--brand-darker)), rgb(var(--brand)))', iconBg: 'linear-gradient(135deg, rgb(var(--brand-darker)), rgb(var(--brand-light)))' },
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
  const { site } = useSite();
  const stats = site.stats;
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
            'radial-gradient(circle, rgb(var(--brand)) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          opacity: 0.06,
        }}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className={`grid grid-cols-2 gap-5 lg:gap-6 ${stats.length === 3 ? 'lg:grid-cols-3' : stats.length >= 4 ? 'lg:grid-cols-4' : ''}`}>
          {stats.map((stat, i) => {
            const pal = palettes[i % palettes.length];
            const Icon = iconFor(stat.icon, BarChart3);
            /* "+" ditampilkan sebagai ikon berdenyut, bukan teks, agar tidak dobel */
            const plus = stat.suffix === '+';
            return (
            <motion.div
              key={`${i}-${stat.label}`}
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
                border: `1px solid rgb(${pal.rgb} / 0.1)`,
                boxShadow: `0 1px 3px rgb(${pal.rgb} / 0.06), 0 4px 16px rgb(${pal.rgb} / 0.03)`,
              }}
            >
              {/* Gradient accent top border */}
              <div
                className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
                style={{ background: pal.top }}
              />

              {/* Hover glow effect */}
              <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, rgb(${pal.rgb} / 0.07) 0%, transparent 70%)`,
                }}
              />

              {/* Large background watermark number */}
              <span
                className="absolute -right-2 -bottom-4 text-7xl font-bold text-brand/[0.04] select-none group-hover:text-brand/[0.08] transition-colors duration-500"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                {stat.value}
              </span>

              <div className="relative z-10">
                {/* Rotating icon container */}
                <motion.div
                  className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: pal.iconBg }}
                  whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1 }}
                  transition={{ duration: 0.5, ease: easing }}
                >
                  <Icon size={22} className="text-white" />
                </motion.div>

                {/* Number with CountUp and pulsing suffix */}
                <div className="flex items-center mb-1">
                  <span
                    className="text-3xl lg:text-4xl font-bold text-[#0F172A]"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    {inView ? (
                      <CountUp
                        start={0}
                        end={stat.value}
                        prefix={stat.prefix}
                        suffix={plus ? '' : stat.suffix}
                        duration={2.5}
                      />
                    ) : (
                      `${stat.prefix}0${plus ? '' : stat.suffix}`
                    )}
                  </span>
                  {/* Show pulsing "+" for stats that have suffix */}
                  {plus && inView && (
                    <PulsingSuffix color="rgb(var(--gold-dark))" delay={i * 0.12 + 2.5} />
                  )}
                  {plus && <span className="sr-only">+</span>}
                </div>

                <p className="text-[#0F172A] font-semibold text-sm">
                  {stat.label}
                </p>
                <p className="text-[#475569] text-xs mt-0.5">{stat.sub}</p>
              </div>

              {/* Bottom gradient line on hover */}
              <motion.div
                className="absolute bottom-0 left-4 right-4 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ background: pal.top }}
              />
            </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

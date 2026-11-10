import { motion } from 'framer-motion';

const clients = [
  { name: 'Kemendikdasmen', logo: '/images/clients/kemendikdasmen.png' },
  { name: 'FDS Group', logo: '/images/clients/fdsgroup.png' },
  { name: 'Taufiq Accounting & Tax Report', logo: '/images/clients/tatreport.png' },
  { name: 'Hisabuna', logo: '/images/clients/hisabuna.svg' },
  { name: 'Ask Creative', logo: '/images/clients/askcreative.png' },
  { name: 'Taman Midi Anggun', logo: '/images/clients/tamanmidianggun.png' },
  { name: 'Latvo', logo: '/images/clients/latvo.png' },
];

export default function ClientMarquee() {
  return (
    <section className="relative py-12 overflow-hidden bg-[#F8FAFC] border-y border-[#E2E8F0]">
      <div className="text-center mb-8">
        <p className="text-xs font-semibold text-[#475569] uppercase tracking-[0.15em]">Telah Dipercaya Oleh</p>
      </div>

      <div className="relative flex overflow-hidden">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-28 z-10 pointer-events-none" style={{ background: 'linear-gradient(90deg, #F8FAFC, transparent)' }} />
        <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-28 z-10 pointer-events-none" style={{ background: 'linear-gradient(270deg, #F8FAFC, transparent)' }} />

        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          className="flex gap-14 sm:gap-20 items-center whitespace-nowrap pr-14 sm:pr-20"
        >
          {[...clients, ...clients].map((client, i) => (
            <img
              key={`${client.name}-${i}`}
              src={client.logo}
              alt={client.name}
              title={client.name}
              loading="lazy"
              decoding="async"
              className="h-9 sm:h-11 w-auto object-contain flex-shrink-0 grayscale opacity-60 hover:grayscale-0 hover:opacity-100 transition-all duration-300 select-none"
              draggable={false}
            />
          ))}
        </motion.div>
      </div>
    </section>
  );
}

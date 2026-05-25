import { motion } from 'framer-motion';

const clients = [
  'Toko Serba Ada', 'Bimbel Cerdas', 'PT Sejahtera Abadi',
  'Desa Digital', 'UMKM Depok', 'Koperasi Sukamaju',
  'Lembaga Pendidika', 'Rumah Makan Sederhana', 'Toko Online Pro',
  'Klinik Sehat', 'Perusahaan Teknologi Nusantara',
];

export default function ClientMarquee() {
  return (
    <section className="relative py-12 overflow-hidden bg-[#FFFBF3] border-y border-[#F0E6D3]">
      <div className="text-center mb-6">
        <p className="text-xs font-semibold text-[#6B6B7B] uppercase tracking-[0.15em]">Dipercaya oleh</p>
      </div>

      <div className="relative flex overflow-hidden">
        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 25, repeat: Infinity, ease: 'linear' }}
          className="flex gap-12 items-center whitespace-nowrap pr-12"
        >
          {[...clients, ...clients].map((client, i) => (
            <span key={i} className="text-sm font-bold text-[#2D2D3A]/30 hover:text-[#D4941A] transition-colors cursor-default select-none flex-shrink-0">
              {client}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

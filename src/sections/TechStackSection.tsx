import { useState } from 'react';
import { motion } from 'framer-motion';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const categories = ['Frontend', 'Backend', 'Mobile', 'Database', 'DevOps', 'Design'];

const techs = [
  { name: 'React', category: 'Frontend', color: '#61DAFB' },
  { name: 'Next.js', category: 'Frontend', color: '#000000' },
  { name: 'Vue.js', category: 'Frontend', color: '#42B883' },
  { name: 'TypeScript', category: 'Frontend', color: '#3178C6' },
  { name: 'Tailwind CSS', category: 'Frontend', color: '#06B6D4' },
  { name: 'Node.js', category: 'Backend', color: '#339933' },
  { name: 'Laravel', category: 'Backend', color: '#FF2D20' },
  { name: 'Python', category: 'Backend', color: '#3776AB' },
  { name: 'Firebase', category: 'Backend', color: '#FFCA28' },
  { name: 'Flutter', category: 'Mobile', color: '#02569B' },
  { name: 'React Native', category: 'Mobile', color: '#61DAFB' },
  { name: 'PostgreSQL', category: 'Database', color: '#4169E1' },
  { name: 'MongoDB', category: 'Database', color: '#47A248' },
  { name: 'MySQL', category: 'Database', color: '#4479A1' },
  { name: 'AWS', category: 'DevOps', color: '#FF9900' },
  { name: 'Docker', category: 'DevOps', color: '#2496ED' },
  { name: 'Figma', category: 'Design', color: '#F24E1E' },
  { name: 'Git', category: 'DevOps', color: '#F05032' },
];

export default function TechStackSection() {
  const [activeCat, setActiveCat] = useState('Frontend');
  const filtered = techs.filter(t => t.category === activeCat);

  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="absolute inset-0 opacity-[0.015]" style={{
        backgroundImage: 'radial-gradient(circle, #F4B942 1px, transparent 1px)',
        backgroundSize: '30px 30px'
      }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-12">
          <span className="section-badge mb-3">Teknologi</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Tech <span className="text-[#0F4C81]">Stack</span> Kami
          </h2>
          <p className="text-[#6B6B7B] max-w-lg mx-auto text-sm">Teknologi modern dan terpercaya yang kami gunakan untuk membangun solusi terbaik.</p>
        </motion.div>

        {/* Category Tabs */}
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2 }} className="flex flex-wrap justify-center gap-2 mb-8">
          {categories.map((cat) => (
            <button key={cat} onClick={() => setActiveCat(cat)}
              className={`btn-small transition-all ${
                activeCat === cat ? 'btn-primary' : 'btn-ghost'
              }`}>
              {cat}
            </button>
          ))}
        </motion.div>

        {/* Tech Grid */}
        <motion.div key={activeCat} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {filtered.map((tech) => (
            <div key={tech.name}
              className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white border border-[#F0E6D3] hover:border-[#F4B942]/30 hover:shadow-md transition-all group">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                style={{ background: tech.color }}>
                {tech.name.charAt(0)}
              </div>
              <span className="text-xs font-semibold text-[#2D2D3A] group-hover:text-[#D4941A] transition-colors">{tech.name}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

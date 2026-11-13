import { motion } from 'framer-motion';
import { MapPin, Briefcase, ArrowUpRight, Banknote, GraduationCap } from 'lucide-react';
import { useSite } from '../lib/siteContext';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

/** Lowongan dikelola dari ERP; section hanya dirender bila ada lowongan (lihat App.tsx). */
export default function CareerSection() {
  const { site, waLink } = useSite();
  const jobs = site.jobs;
  if (jobs.length === 0) return null;
  return (
    <section id="karir" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 50%, #F8FAFC 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-14">
          <span className="section-badge mb-3">Karir</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Bergabung <span className="text-accent">Bersama Kami</span>
          </h2>
          <p className="text-[#475569] max-w-lg mx-auto text-sm">Kami selalu mencari talenta terbaik untuk memperkuat tim. Lihat lowongan yang tersedia.</p>
        </motion.div>

        <div className="space-y-4">
          {jobs.map((job, i) => (
            <motion.div
              key={`${i}-${job.title}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="warm-card p-5 lg:p-6 group"
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="text-lg font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{job.title}</h3>
                    {job.type && (
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${/full/i.test(job.type) ? 'bg-gold/20 text-gold-ink' : 'bg-brand-tint text-brand'}`}>
                        {job.type}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#475569] mb-3">{job.desc}</p>
                  <div className="flex flex-wrap gap-3">
                    {job.location && <span className="flex items-center gap-1 text-xs text-[#475569]"><MapPin size={12} className="text-brand" /> {job.location}</span>}
                    {job.salary && <span className="flex items-center gap-1 text-xs text-[#475569]"><Banknote size={12} className="text-brand" /> {job.salary}</span>}
                    {job.edu && <span className="flex items-center gap-1 text-xs text-[#475569]"><GraduationCap size={12} className="text-brand" /> {job.edu}</span>}
                  </div>
                </div>
                <a href={waLink(`Halo, saya tertarik melamar posisi ${job.title}`)} target="_blank" rel="noopener noreferrer"
                  className="btn-primary btn-small">
                  Lamar <ArrowUpRight size={14} />
                </a>
              </div>

              {/* Requirements */}
              {job.requirements.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
                <p className="text-xs font-semibold text-[#475569] mb-2">Kualifikasi:</p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {job.requirements.map((r) => (
                    <span key={r} className="flex items-start gap-1.5 text-xs text-[#0F172A]/70">
                      <Briefcase size={12} className="text-brand mt-0.5 flex-shrink-0" /> {r}
                    </span>
                  ))}
                </div>
              </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

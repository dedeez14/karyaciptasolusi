import { motion } from 'framer-motion';
import { MapPin, Briefcase, ArrowUpRight, Banknote, GraduationCap } from 'lucide-react';

const easing = [0.16, 1, 0.3, 1] as [number, number, number, number];

const jobs = [
  {
    title: 'Web Developer',
    type: 'Full-time',
    location: 'Depok / Remote',
    salary: 'Rp 4.000.000 - 8.000.000',
    edu: 'D3/S1 Teknik Informatika',
    desc: 'Mengembangkan aplikasi web menggunakan React, Node.js, dan teknologi modern lainnya.',
    requirements: ['Pengalaman 1+ tahun dengan React/Next.js', 'Menguasai HTML, CSS, JavaScript', 'Familiar dengan REST API dan database', 'Mampu bekerja secara mandiri dan tim'],
  },
  {
    title: 'Mobile Developer (Flutter)',
    type: 'Full-time',
    location: 'Depok / Remote',
    salary: 'Rp 5.000.000 - 10.000.000',
    edu: 'D3/S1 Teknik Informatika',
    desc: 'Membangun aplikasi mobile cross-platform menggunakan Flutter untuk klien kami.',
    requirements: ['Pengalaman 1+ tahun dengan Flutter', 'Menguasai Dart programming', 'Pernah publish app ke Play Store/App Store', 'Memahami state management (Provider/Bloc)'],
  },
  {
    title: 'UI/UX Designer',
    type: 'Part-time / Project',
    location: 'Remote',
    salary: 'Rp 3.000.000 - 6.000.000',
    edu: 'D3/S1 Desain Komunikasi Visual',
    desc: 'Mendesain antarmuka dan pengalaman pengguna untuk aplikasi web dan mobile.',
    requirements: ['Pengalaman dengan Figma/Adobe XD', 'Memahami prinsip UI/UX design', 'Mampu membuat prototype interaktif', 'Portfolio yang menarik'],
  },
  {
    title: 'IT Support / Helpdesk',
    type: 'Full-time',
    location: 'Depok',
    salary: 'Rp 3.500.000 - 5.000.000',
    edu: 'D2/D3 Teknik Komputer',
    desc: 'Memberikan dukungan teknis dan troubleshooting untuk klien serta internal tim.',
    requirements: ['Pengetahuan hardware dan software', 'Pengalaman troubleshooting jaringan', 'Komunikasi yang baik', 'Bersedia on-site di Depok'],
  },
];

export default function CareerSection() {

  return (<></>);
  return (
    <section id="karir" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 50%, #F8FAFC 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: easing }} className="text-center mb-14">
          <span className="section-badge mb-3">Karir</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Bergabung <span style={{ color: '#1D4ED8' }}>Bersama Kami</span>
          </h2>
          <p className="text-[#475569] max-w-lg mx-auto text-sm">Kami selalu mencari talenta terbaik untuk memperkuat tim. Lihat lowongan yang tersedia.</p>
        </motion.div>

        <div className="space-y-4">
          {jobs.map((job, i) => (
            <motion.div
              key={job.title}
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
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${job.type === 'Full-time' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                      {job.type}
                    </span>
                  </div>
                  <p className="text-sm text-[#475569] mb-3">{job.desc}</p>
                  <div className="flex flex-wrap gap-3">
                    <span className="flex items-center gap-1 text-xs text-[#475569]"><MapPin size={12} style={{ color: '#1D4ED8' }} /> {job.location}</span>
                    <span className="flex items-center gap-1 text-xs text-[#475569]"><Banknote size={12} style={{ color: '#1D4ED8' }} /> {job.salary}</span>
                    <span className="flex items-center gap-1 text-xs text-[#475569]"><GraduationCap size={12} style={{ color: '#1D4ED8' }} /> {job.edu}</span>
                  </div>
                </div>
                <a href="https://wa.me/6283898911244?text=Halo,%20saya%20tertarik%20melamar%20posisi%20" target="_blank" rel="noopener noreferrer"
                  className="btn-primary btn-small">
                  Lamar <ArrowUpRight size={14} />
                </a>
              </div>

              {/* Requirements */}
              <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
                <p className="text-xs font-semibold text-[#475569] mb-2">Kualifikasi:</p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {job.requirements.map((r) => (
                    <span key={r} className="flex items-start gap-1.5 text-xs text-[#0F172A]/70">
                      <Briefcase size={12} className="text-[#2563EB] mt-0.5 flex-shrink-0" /> {r}
                    </span>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

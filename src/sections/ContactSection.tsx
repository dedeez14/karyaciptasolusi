import { motion } from 'framer-motion';
import { Phone, Mail, MapPin, Clock, ExternalLink } from 'lucide-react';

const contacts = [
  { icon: Phone, label: 'Telepon PT', value: '0838-9891-1244', href: 'tel:083898911244', bg: 'bg-[#2563EB]', iconColor: 'text-white' },
  { icon: Mail, label: 'Email', value: 'pt.karyaciptasolusi@gmail.com', href: 'mailto:pt.karyaciptasolusi@gmail.com', bg: 'bg-[#0F4C81]', iconColor: 'text-white' },
];

export default function ContactSection() {
  return (
    <section id="kontak" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(135deg, #EFF6FF 0%, #F8FAFC 50%, #DBEAFE 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-14">
          <span className="section-badge mb-3">Hubungi Kami</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Mari <span style={{ color: '#1D4ED8' }}>Bekerjasama</span></h2>
          <p className="text-[#475569] mt-4 max-w-lg mx-auto text-sm">Konsultasikan kebutuhan teknologi bisnis Anda. Kami siap membantu.</p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8">
          <div className="lg:col-span-2 space-y-4">
            {contacts.map((c, i) => (
              <motion.a key={c.label} href={c.href} initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group flex items-center gap-4 p-4 rounded-xl bg-white border border-[#E2E8F0] hover:border-[#2563EB]/30 transition-all hover:shadow-md">
                <div className={`w-11 h-11 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                  <c.icon size={18} className={c.iconColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-[#475569] font-semibold uppercase tracking-wider">{c.label}</p>
                  <p className="text-[#0F172A] font-semibold text-sm truncate">{c.value}</p>
                </div>
                <ExternalLink size={14} className="text-[#E2E8F0] group-hover:text-[#2563EB] transition-colors flex-shrink-0" />
              </motion.a>
            ))}

            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }}
              className="p-4 rounded-xl bg-white border border-[#E2E8F0]">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                  <MapPin size={18} style={{ color: '#1D4ED8' }} />
                </div>
                <div>
                  <p className="text-[10px] text-[#475569] font-semibold uppercase tracking-wider mb-1">Alamat</p>
                  <address className="not-italic text-[#0F172A]/70 text-sm leading-relaxed">
                    Kp. Sindangkarsa, RT.05/RW.15<br />Kel. Sukamaju Baru, Kec. Tapos<br />Kota Depok, Jawa Barat 16455
                  </address>
                  <a href="https://maps.app.goo.gl/4EexXJFYvVogySuq8" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-xs mt-2 hover:underline" style={{ color: '#1D4ED8' }}>
                    Buka di Google Maps <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.4 }}
              className="p-4 rounded-xl bg-white border border-[#E2E8F0]">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
                  <Clock size={18} style={{ color: '#1D4ED8' }} />
                </div>
                <div>
                  <p className="text-[10px] text-[#475569] font-semibold uppercase tracking-wider mb-1">Jam Operasional</p>
                  <p className="text-[#0F172A]/70 text-sm">Senin - Jumat: 09.00 - 17.00 WIB</p>
                  <p className="text-[#0F172A]/70 text-sm">Sabtu: 09.00 - 14.00 WIB</p>
                  <p className="text-[#475569] text-xs mt-1">Minggu & Hari Libur: Tutup</p>
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-3 rounded-2xl overflow-hidden border border-[#E2E8F0] bg-white shadow-md">
            <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d15859.189!2d106.9!3d-6.4!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNsKwMjQnMDAuMCJTIDEwNsKwNTQnMDAuMCJF!5e0!3m2!1sid!2sid!4v1"
              className="w-full h-full min-h-[400px] lg:min-h-0 border-0" allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade" title="Lokasi PT Karya Cipta Solusi" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

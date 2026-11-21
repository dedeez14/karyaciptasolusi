import { motion } from 'framer-motion';
import { Fragment } from 'react';
import { Phone, Mail, MapPin, Clock, ExternalLink } from 'lucide-react';
import { useSite } from '../lib/siteContext';
import { addressLines } from '../lib/site';

export default function ContactSection() {
  const { site, telLink } = useSite();
  const { company } = site;
  const contacts = [
    { icon: Phone, label: 'Telepon PT', value: company.phone, href: telLink(), bg: 'bg-brand' },
    { icon: Mail, label: 'Email', value: company.email, href: `mailto:${company.email}`, bg: 'bg-brand-dark' },
  ];
  return (
    <section id="kontak" className="relative py-24 lg:py-32 overflow-hidden" style={{ background: 'linear-gradient(135deg, rgb(var(--brand-tint)) 0%, #F8FAFC 50%, rgb(var(--brand-tint-strong)) 100%)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="text-center mb-14">
          <span className="section-badge mb-3">Hubungi Kami</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#0F172A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Mari <span className="text-accent">Bekerjasama</span></h2>
          <p className="text-[#475569] mt-4 max-w-lg mx-auto text-sm">Konsultasikan kebutuhan teknologi bisnis Anda. Kami siap membantu.</p>
        </motion.div>

        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8">
          <div className="lg:col-span-2 space-y-4">
            {contacts.map((c, i) => (
              <motion.a key={c.label} href={c.href} initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="group flex items-center gap-4 p-4 rounded-xl bg-white border border-[#E2E8F0] hover:border-brand/30 transition-all hover:shadow-md">
                <div className={`w-11 h-11 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                  <c.icon size={18} className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-[#475569] font-semibold uppercase tracking-wider">{c.label}</p>
                  <p className="text-[#0F172A] font-semibold text-sm truncate">{c.value}</p>
                </div>
                <ExternalLink size={14} className="text-[#CBD5E1] group-hover:text-brand transition-colors flex-shrink-0" aria-hidden="true" />
              </motion.a>
            ))}

            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.3 }}
              className="p-4 rounded-xl bg-white border border-[#E2E8F0]">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-brand-tint flex items-center justify-center flex-shrink-0">
                  <MapPin size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-[10px] text-[#475569] font-semibold uppercase tracking-wider mb-1">Alamat</p>
                  <address className="not-italic text-[#0F172A]/70 text-sm leading-relaxed">
                    {addressLines(company.address).map((line, i) => (
                      <Fragment key={i}>{i > 0 && <br />}{line}</Fragment>
                    ))}
                  </address>
                  <a href={company.mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 min-h-[44px] font-semibold text-xs text-brand hover:underline decoration-gold decoration-2 underline-offset-4">
                    Buka di Google Maps <ExternalLink size={10} />
                  </a>
                </div>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.4 }}
              className="p-4 rounded-xl bg-white border border-[#E2E8F0]">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-brand-tint flex items-center justify-center flex-shrink-0">
                  <Clock size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-[10px] text-[#475569] font-semibold uppercase tracking-wider mb-1">Jam Operasional</p>
                  {company.hours.map((h) => (
                    <p key={h} className="text-[#0F172A]/70 text-sm">{h}</p>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>

          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.2 }}
            className="lg:col-span-3 rounded-2xl overflow-hidden border border-[#E2E8F0] bg-white shadow-md">
            <iframe src={company.mapsEmbedUrl}
              className="w-full h-full min-h-[400px] lg:min-h-0 border-0" allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade" title={`Lokasi ${company.name}`} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

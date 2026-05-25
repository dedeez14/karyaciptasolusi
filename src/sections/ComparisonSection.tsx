import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useState } from 'react';

const features = [
  { name: 'Aplikasi Web/Mobile', starter: '1', business: 'Unlimited', enterprise: 'Unlimited' },
  { name: 'Maintenance & Bug Fix', starter: true, business: true, enterprise: true },
  { name: 'Support 24/7', starter: false, business: true, enterprise: true },
  { name: 'Dedicated Developer', starter: false, business: false, enterprise: true },
  { name: 'Konsultasi IT', starter: false, business: 'Bulanan', enterprise: 'Unlimited' },
  { name: 'Backup Otomatis', starter: false, business: true, enterprise: true },
  { name: 'Report & Analytics', starter: 'Bulanan', business: 'Mingguan', enterprise: 'Real-time' },
  { name: 'Garansi', starter: '1 Bulan', business: '3 Bulan', enterprise: '6 Bulan' },
  { name: 'On-site Support', starter: false, business: false, enterprise: true },
  { name: 'Prioritas Response', starter: 'Normal', business: 'High', enterprise: 'Highest' },
  { name: 'Custom Integration', starter: false, business: true, enterprise: true },
  { name: 'Source Code', starter: false, business: true, enterprise: true },
];

export default function ComparisonSection() {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  return (
    <section className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
          className="text-center mb-12">
          <span className="section-badge mb-3">Perbandingan</span>
          <h2 className="text-4xl lg:text-5xl font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Bandingkan <span style={{ color: '#D4941A' }}>Paket</span>
          </h2>
          <p className="text-[#6B6B7B] max-w-lg mx-auto text-sm">Lihat perbedaan fitur detail untuk setiap paket yang kami tawarkan.</p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.2 }}
          className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b-2 border-[#F4B942]">
                <th className="text-left py-4 px-4 text-sm font-bold text-[#2D2D3A]">Fitur</th>
                <th className="text-center py-4 px-4 text-sm font-bold text-[#6B6B7B]">Starter</th>
                <th className="text-center py-4 px-4 text-sm font-bold text-[#D4941A] bg-[#FFF8E7] rounded-t-lg">Business</th>
                <th className="text-center py-4 px-4 text-sm font-bold text-[#0F4C81]">Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {features.map((f, i) => (
                <tr
                  key={f.name}
                  className={`border-b border-[#F0E6D3] transition-colors ${hoveredRow === i ? 'bg-[#FFF8E7]/30' : ''}`}
                  onMouseEnter={() => setHoveredRow(i)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <td className="py-3 px-4 text-sm text-[#2D2D3A] font-medium">{f.name}</td>
                  <td className="py-3 px-4 text-center">
                    {typeof f.starter === 'boolean' ? (
                      f.starter ? <Check size={16} className="text-green-500 mx-auto" /> : <X size={16} className="text-red-300 mx-auto" />
                    ) : (
                      <span className="text-xs text-[#6B6B7B]">{f.starter}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center bg-[#FFF8E7]/20">
                    {typeof f.business === 'boolean' ? (
                      f.business ? <Check size={16} className="text-green-500 mx-auto" /> : <X size={16} className="text-red-300 mx-auto" />
                    ) : (
                      <span className="text-xs font-semibold text-[#D4941A]">{f.business}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {typeof f.enterprise === 'boolean' ? (
                      f.enterprise ? <Check size={16} className="text-green-500 mx-auto" /> : <X size={16} className="text-red-300 mx-auto" />
                    ) : (
                      <span className="text-xs font-semibold text-[#0F4C81]">{f.enterprise}</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-4 px-4"></td>
                <td className="py-4 px-4 text-center">
                  <a href="https://wa.me/6285601771312" target="_blank" rel="noopener noreferrer"
                    className="btn-secondary btn-small">Pilih</a>
                </td>
                <td className="py-4 px-4 text-center bg-[#FFF8E7]/20">
                  <a href="https://wa.me/6285601771312" target="_blank" rel="noopener noreferrer"
                    className="btn-primary btn-small">Pilih</a>
                </td>
                <td className="py-4 px-4 text-center">
                  <a href="https://wa.me/6285601771312" target="_blank" rel="noopener noreferrer"
                    className="btn-blue btn-small">Pilih</a>
                </td>
              </tr>
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}

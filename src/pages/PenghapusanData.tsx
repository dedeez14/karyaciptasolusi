import { Link } from 'react-router-dom';
import { MessageCircle, Mail, ArrowRight } from 'lucide-react';
import LegalPage, { type LegalSection } from '../components/LegalPage';
import { usePageMeta } from '../hooks/usePageMeta';

const UPDATED = '18 Agustus 2026';

const WA_TEXT = encodeURIComponent(
  'Halo PT Karya Cipta Solusi, saya ingin mengajukan penghapusan data pribadi saya.\n\nNama lengkap: \nEmail yang pernah saya gunakan: \nNomor WhatsApp: \nData yang ingin dihapus: semua data saya',
);
const MAIL_SUBJECT = encodeURIComponent('Permintaan Penghapusan Data Pribadi');
const MAIL_BODY = encodeURIComponent(
  'Kepada PT Karya Cipta Solusi,\n\nSaya mengajukan permintaan penghapusan data pribadi saya dengan rincian berikut:\n\nNama lengkap: \nEmail yang pernah digunakan: \nNomor telepon/WhatsApp: \nData yang ingin dihapus: semua data saya\n\nTerima kasih.',
);

const sections: LegalSection[] = [
  {
    heading: 'Data Apa Saja yang Dapat Dihapus',
    paragraphs: [
      'Permintaan penghapusan mencakup data pribadi yang pernah Anda sampaikan kepada kami melalui kanal resmi kami, antara lain:',
    ],
    bullets: [
      'Nama, alamat email, dan nomor telepon yang Anda kirimkan melalui formulir kontak atau percakapan dengan kami.',
      'Isi pesan, pertanyaan, atau permintaan penawaran yang pernah Anda sampaikan.',
      'Alamat email yang terdaftar untuk menerima informasi dan pembaruan dari kami.',
      'Data profil yang Anda berikan apabila Anda pernah mengisi formulir lamaran atau formulir kerja sama.',
    ],
  },
  {
    heading: 'Berapa Lama Prosesnya',
    paragraphs: [
      'Setelah permintaan Anda kami terima dan identitas Anda dapat kami pastikan, kami akan memproses penghapusan dalam waktu paling lama 14 hari kerja. Kami akan mengirimkan konfirmasi kepada Anda melalui kanal yang sama dengan yang Anda gunakan untuk mengajukan permintaan.',
      'Kami mungkin meminta Anda menyebutkan kembali nama atau alamat email yang pernah digunakan, semata-mata untuk memastikan bahwa permintaan benar-benar berasal dari pemilik data.',
    ],
  },
  {
    heading: 'Data yang Mungkin Tetap Kami Simpan',
    paragraphs: [
      'Terdapat sebagian kecil data yang tidak dapat kami hapus sepenuhnya karena kewajiban hukum, yaitu dokumen yang wajib disimpan untuk keperluan pembukuan, perpajakan, dan bukti perjanjian apabila kita pernah terikat kerja sama resmi. Dokumen semacam ini disimpan terbatas untuk keperluan tersebut dan tidak digunakan untuk menghubungi Anda kembali maupun untuk keperluan pemasaran.',
    ],
  },
  {
    heading: 'Menghapus Data yang Tersimpan di Perangkat Anda Sendiri',
    paragraphs: [
      'Beberapa data, seperti penanda bahwa Anda telah menutup pemberitahuan cookie dan salinan isian formulir, tersimpan di penyimpanan lokal peramban pada perangkat Anda, bukan di server kami. Data semacam ini sepenuhnya berada dalam kendali Anda dan dapat dihapus kapan saja melalui pengaturan peramban, umumnya pada menu Riwayat atau Privasi, dengan memilih opsi untuk menghapus data situs (cookies dan data situs) untuk karyaciptasolusi.com.',
    ],
  },
  {
    heading: 'Penghapusan Data Terkait Platform Media Sosial',
    paragraphs: [
      'Apabila Anda pernah berinteraksi dengan kami melalui platform media sosial seperti Facebook, Instagram, atau WhatsApp, Anda juga dapat mengelola dan menghapus data Anda langsung melalui pengaturan akun pada platform tersebut. Untuk data yang berada dalam catatan kami, silakan gunakan salah satu cara pengajuan di halaman ini.',
    ],
  },
];

export default function PenghapusanData() {
  usePageMeta({
    title: 'Permintaan Penghapusan Data Pengguna | PT Karya Cipta Solusi',
    description:
      'Cara mengajukan penghapusan data pribadi Anda dari catatan PT Karya Cipta Solusi. Permintaan diproses paling lama 14 hari kerja.',
    canonicalPath: '/penghapusan-data',
  });

  return (
    <LegalPage
      title="Penghapusan Data Pengguna"
      intro="Anda berhak meminta agar data pribadi Anda dihapus dari catatan kami. Halaman ini menjelaskan cara mengajukannya, apa saja yang dihapus, dan berapa lama prosesnya."
      updatedAt={UPDATED}
      sections={sections}
      footerNote="Permintaan penghapusan tidak dikenakan biaya apa pun. Jika Anda tidak menerima konfirmasi dalam 14 hari kerja, silakan hubungi kami kembali agar permintaan Anda dapat kami telusuri."
    >
      {/* Cara mengajukan */}
      <section className="mb-11">
        <h2
          className="text-xl lg:text-[22px] font-bold text-[#0F172A] mb-2"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Cara Mengajukan Permintaan
        </h2>
        <p className="text-[16px] text-[#334155] leading-[1.8] mb-5">
          Pilih salah satu cara di bawah ini. Sebutkan nama lengkap dan alamat email atau nomor
          telepon yang pernah Anda gunakan saat menghubungi kami, agar kami dapat menemukan data
          Anda.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <a
            href={`https://wa.me/6283898911244?text=${WA_TEXT}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col p-6 rounded-2xl border border-[#E2E8F0] bg-white hover:border-[#22C55E]/50 hover:shadow-lg transition-all duration-300"
          >
            <div className="w-11 h-11 rounded-xl bg-[#22C55E] flex items-center justify-center mb-4">
              <MessageCircle size={21} className="text-white" />
            </div>
            <p className="font-bold text-[#0F172A] mb-1">Ajukan lewat WhatsApp</p>
            <p className="text-sm text-[#475569] leading-relaxed mb-4">
              Cara tercepat. Pesan sudah kami siapkan formatnya, Anda tinggal melengkapi data.
            </p>
            <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-bold text-[#16A34A]">
              0838-9891-1244
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </span>
          </a>

          <a
            href={`mailto:pt.karyaciptasolusi@gmail.com?subject=${MAIL_SUBJECT}&body=${MAIL_BODY}`}
            className="group flex flex-col p-6 rounded-2xl border border-[#E2E8F0] bg-white hover:border-[#2563EB]/50 hover:shadow-lg transition-all duration-300"
          >
            <div className="w-11 h-11 rounded-xl bg-[#1D4ED8] flex items-center justify-center mb-4">
              <Mail size={21} className="text-white" />
            </div>
            <p className="font-bold text-[#0F172A] mb-1">Ajukan lewat Email</p>
            <p className="text-sm text-[#475569] leading-relaxed mb-4">
              Cocok bila Anda ingin menyimpan bukti tertulis atas permintaan Anda.
            </p>
            <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-bold text-[#1D4ED8] break-all">
              pt.karyaciptasolusi@gmail.com
              <ArrowRight size={14} className="flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </a>
        </div>
      </section>

      <div className="mb-11 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
        <p className="text-sm text-[#334155] leading-relaxed">
          Ingin tahu lebih dulu data apa saja yang kami kumpulkan dan untuk apa? Silakan baca{' '}
          <Link to="/kebijakan-privasi" className="font-bold text-[#1D4ED8] hover:underline">
            Kebijakan Privasi
          </Link>{' '}
          kami.
        </p>
      </div>
    </LegalPage>
  );
}

import { Link } from 'react-router-dom';
import LegalPage, { type LegalSection } from '../components/LegalPage';
import { usePageMeta } from '../hooks/usePageMeta';

const UPDATED = '18 Agustus 2026';

const sections: LegalSection[] = [
  {
    heading: '1. Siapa Kami',
    paragraphs: [
      'PT Karya Cipta Solusi adalah perusahaan penyedia jasa pembuatan website, pengembangan aplikasi, dan konsultasi teknologi informasi yang berkedudukan di Kp. Sindangkarsa, RT.05/RW.15, Kel. Sukamaju Baru, Kec. Tapos, Kota Depok, Jawa Barat 16455, Indonesia.',
      'Dalam kebijakan ini, kata "kami" merujuk pada PT Karya Cipta Solusi, dan kata "Anda" merujuk pada pengunjung situs karyaciptasolusi.com maupun orang yang menghubungi kami melalui kanal resmi kami.',
    ],
  },
  {
    heading: '2. Data yang Kami Kumpulkan',
    paragraphs: [
      'Kami hanya mengumpulkan data yang Anda berikan secara sukarela, serta data teknis terbatas yang otomatis tercatat saat Anda membuka situs kami.',
    ],
    bullets: [
      'Data yang Anda kirimkan lewat formulir kontak: nama, alamat email, nomor telepon, subjek, dan isi pesan.',
      'Data yang Anda kirimkan saat berlangganan pembaruan: alamat email.',
      'Data yang Anda sampaikan dalam percakapan WhatsApp, telepon, atau email ketika berkonsultasi dengan kami.',
      'Data teknis dasar yang tercatat oleh penyedia layanan hosting kami, seperti alamat IP, jenis peramban, dan waktu kunjungan, yang digunakan untuk menjaga keamanan dan kestabilan situs.',
      'Preferensi yang disimpan di peramban Anda, misalnya penanda bahwa Anda telah menutup pemberitahuan cookie.',
    ],
  },
  {
    heading: '3. Bagaimana Data Anda Diproses',
    paragraphs: [
      'Formulir kontak dan formulir berlangganan di situs kami tidak menyimpan data Anda di server kami. Ketika Anda menekan tombol kirim, isian tersebut disusun menjadi pesan dan diteruskan ke aplikasi WhatsApp pada perangkat Anda, sehingga Andalah yang menekan tombol kirim terakhir. Salinan isian juga tersimpan sementara di penyimpanan lokal peramban Anda sendiri agar tampilan situs tetap berfungsi, dan salinan itu tidak dikirimkan ke mana pun.',
      'Artinya, data Anda baru sampai kepada kami ketika Anda benar-benar mengirimkan pesan tersebut kepada kami melalui WhatsApp, email, atau telepon.',
    ],
  },
  {
    heading: '4. Tujuan Penggunaan Data',
    bullets: [
      'Menjawab pertanyaan, permintaan konsultasi, dan permintaan penawaran dari Anda.',
      'Menyusun penawaran, kontrak, faktur, dan dokumen kerja sama apabila Anda melanjutkan ke tahap kerja sama.',
      'Melaksanakan dan mendukung layanan yang Anda pesan, termasuk komunikasi selama proyek berjalan.',
      'Mengirimkan informasi, tips, atau pembaruan layanan apabila Anda menyatakan bersedia menerimanya.',
      'Memenuhi kewajiban hukum, perpajakan, dan administrasi yang berlaku bagi kami sebagai badan usaha.',
      'Menjaga keamanan situs serta mencegah penyalahgunaan dan aktivitas yang merugikan.',
    ],
  },
  {
    heading: '5. Dasar Pemrosesan dan Persetujuan',
    paragraphs: [
      'Kami memproses data pribadi Anda berdasarkan persetujuan yang Anda berikan saat menghubungi kami, berdasarkan kebutuhan pelaksanaan perjanjian kerja sama, serta berdasarkan kewajiban hukum yang berlaku bagi kami. Anda dapat menarik persetujuan tersebut kapan saja dengan menghubungi kami, tanpa memengaruhi keabsahan pemrosesan yang telah dilakukan sebelumnya.',
    ],
  },
  {
    heading: '6. Berbagi Data dengan Pihak Ketiga',
    paragraphs: [
      'Kami tidak menjual, menyewakan, atau memperdagangkan data pribadi Anda kepada siapa pun. Data Anda dapat diproses oleh pihak ketiga hanya sebatas yang diperlukan agar layanan kami berjalan:',
    ],
    bullets: [
      'Penyedia layanan pesan (WhatsApp) dan penyedia surel, sebagai sarana komunikasi antara Anda dan kami.',
      'Penyedia hosting dan infrastruktur situs, yang memproses data teknis kunjungan.',
      'Google Fonts, yang memuat huruf pada situs ini, serta Google Maps apabila Anda melihat peta lokasi kami.',
      'Platform periklanan dan media sosial, apabila Anda mengunjungi situs kami melalui iklan atau tautan dari platform tersebut, sesuai kebijakan privasi masing-masing platform.',
      'Aparat penegak hukum atau instansi berwenang, apabila diwajibkan oleh peraturan perundang-undangan yang berlaku.',
    ],
  },
  {
    heading: '7. Cookie dan Teknologi Serupa',
    paragraphs: [
      'Situs kami menggunakan penyimpanan lokal peramban untuk hal-hal sederhana, seperti mengingat bahwa Anda sudah menutup pemberitahuan cookie. Penyimpanan ini tidak digunakan untuk membangun profil pribadi Anda.',
      'Anda dapat menghapus data tersebut kapan saja melalui pengaturan peramban Anda, dan situs kami tetap dapat digunakan dengan normal setelahnya.',
    ],
  },
  {
    heading: '8. Penyimpanan dan Keamanan Data',
    paragraphs: [
      'Kami menyimpan data Anda hanya selama diperlukan untuk tujuan di atas atau selama diwajibkan oleh peraturan yang berlaku, misalnya untuk keperluan pembukuan dan perpajakan.',
      'Situs kami dilindungi sertifikat keamanan (HTTPS) sehingga data yang dikirim melalui peramban terenkripsi dalam perjalanannya. Kami juga menerapkan pembatasan akses internal terhadap komunikasi dan dokumen klien. Meski demikian, tidak ada metode pengiriman data melalui internet yang sepenuhnya bebas risiko, dan kami menganjurkan Anda untuk tidak mengirimkan informasi yang sangat sensitif melalui saluran terbuka.',
    ],
  },
  {
    heading: '9. Hak Anda atas Data Pribadi',
    paragraphs: [
      'Sesuai peraturan perlindungan data pribadi yang berlaku di Indonesia, Anda memiliki sejumlah hak atas data pribadi Anda:',
    ],
    bullets: [
      'Meminta informasi mengenai data pribadi Anda yang kami simpan.',
      'Meminta perbaikan atas data yang tidak akurat atau tidak lengkap.',
      'Meminta penghapusan data pribadi Anda, sepanjang tidak bertentangan dengan kewajiban hukum kami.',
      'Menarik persetujuan pemrosesan data yang sebelumnya Anda berikan.',
      'Berhenti menerima informasi atau pembaruan dari kami kapan saja.',
      'Mengajukan keberatan atau keluhan atas pemrosesan data pribadi Anda oleh kami.',
    ],
  },
  {
    heading: '10. Data Anak',
    paragraphs: [
      'Layanan kami ditujukan untuk pelaku usaha dan kalangan dewasa. Kami tidak dengan sengaja mengumpulkan data pribadi anak di bawah umur. Apabila Anda mengetahui bahwa data seorang anak telah dikirimkan kepada kami, silakan hubungi kami agar data tersebut dapat kami hapus.',
    ],
  },
  {
    heading: '11. Perubahan Kebijakan',
    paragraphs: [
      'Kami dapat memperbarui kebijakan privasi ini sewaktu-waktu, misalnya ketika layanan kami berkembang atau ketika peraturan berubah. Versi terbaru selalu tersedia di halaman ini beserta tanggal pembaruannya. Perubahan yang bersifat mendasar akan kami upayakan untuk diberitahukan melalui situs kami.',
    ],
  },
  {
    heading: '12. Menghubungi Kami',
    paragraphs: [
      'Apabila Anda memiliki pertanyaan, permintaan, atau keluhan terkait data pribadi Anda, silakan hubungi kami melalui email pt.karyaciptasolusi@gmail.com, WhatsApp 0838-9891-1244, atau surat ke alamat kantor kami di Kp. Sindangkarsa, RT.05/RW.15, Kel. Sukamaju Baru, Kec. Tapos, Kota Depok, Jawa Barat 16455.',
      'Kami berupaya menanggapi setiap permintaan terkait data pribadi dalam waktu yang wajar, umumnya paling lama 14 hari kerja sejak permintaan diterima dan identitas pemohon dapat kami pastikan.',
    ],
  },
];

export default function KebijakanPrivasi() {
  usePageMeta({
    title: 'Kebijakan Privasi | PT Karya Cipta Solusi',
    description:
      'Kebijakan privasi PT Karya Cipta Solusi: data apa yang kami kumpulkan, bagaimana kami menggunakannya, dan hak Anda atas data pribadi Anda.',
    canonicalPath: '/kebijakan-privasi',
  });

  return (
    <LegalPage
      title="Kebijakan Privasi"
      intro="Kami menghargai privasi Anda. Halaman ini menjelaskan data apa yang kami kumpulkan, untuk apa data itu digunakan, dan hak apa saja yang Anda miliki atas data pribadi Anda."
      updatedAt={UPDATED}
      sections={sections}
      footerNote="Dokumen ini disusun untuk memberikan penjelasan yang jelas dan jujur mengenai praktik data kami. Untuk kepastian hukum yang menyeluruh sesuai kondisi usaha Anda, kami menganjurkan konsultasi dengan penasihat hukum."
    >
      <div className="mb-10 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
        <p className="text-sm text-[#334155] leading-relaxed">
          Ingin data Anda dihapus dari catatan kami? Kami menyediakan halaman khusus berisi
          langkah-langkahnya:{' '}
          <Link to="/penghapusan-data" className="font-bold text-[#1D4ED8] hover:underline">
            Permintaan Penghapusan Data Pengguna
          </Link>
          .
        </p>
      </div>
    </LegalPage>
  );
}

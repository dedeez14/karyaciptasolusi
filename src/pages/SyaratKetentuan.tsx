import { Link } from 'react-router-dom';
import LegalPage, { type LegalSection } from '../components/LegalPage';
import { usePageMeta } from '../hooks/usePageMeta';

const UPDATED = '18 Agustus 2026';

const sections: LegalSection[] = [
  {
    heading: '1. Penerimaan Ketentuan',
    paragraphs: [
      'Dengan mengakses dan menggunakan situs karyaciptasolusi.com, Anda dianggap telah membaca, memahami, dan menyetujui syarat dan ketentuan ini. Apabila Anda tidak menyetujuinya, kami menganjurkan Anda untuk tidak menggunakan situs ini.',
    ],
  },
  {
    heading: '2. Tentang Layanan Kami',
    paragraphs: [
      'PT Karya Cipta Solusi menyediakan jasa pembuatan website, pengembangan aplikasi, konsultasi teknologi informasi, penyediaan platform digital, serta layanan pengolahan data dan hosting.',
      'Situs ini berfungsi sebagai profil perusahaan dan sarana informasi. Pemesanan layanan tidak terjadi secara otomatis melalui situs, melainkan melalui proses konsultasi dan kesepakatan tertulis antara Anda dan kami.',
    ],
  },
  {
    heading: '3. Informasi pada Situs Ini',
    paragraphs: [
      'Kami berupaya menyajikan informasi yang akurat dan mutakhir, termasuk pada artikel-artikel di halaman blog kami. Meski demikian, isi situs ini bersifat informatif dan edukatif secara umum, bukan merupakan nasihat profesional yang mengikat untuk kondisi spesifik usaha Anda.',
      'Keputusan yang Anda ambil berdasarkan informasi di situs ini merupakan tanggung jawab Anda sendiri. Untuk keputusan penting, kami menganjurkan Anda berkonsultasi lebih dahulu dengan kami atau dengan penasihat profesional yang relevan.',
    ],
  },
  {
    heading: '4. Penawaran, Harga, dan Kesepakatan',
    paragraphs: [
      'Kami tidak menerapkan paket harga tetap. Setiap penawaran disusun berdasarkan hasil konsultasi dan menyesuaikan lingkup pekerjaan yang disepakati. Harga, jangka waktu, dan cakupan pekerjaan yang mengikat adalah yang tercantum dalam dokumen penawaran atau perjanjian tertulis yang ditandatangani kedua pihak.',
      'Informasi layanan yang tercantum di situs ini bukan merupakan penawaran yang mengikat, melainkan gambaran umum mengenai apa yang dapat kami kerjakan.',
    ],
  },
  {
    heading: '5. Kekayaan Intelektual',
    paragraphs: [
      'Seluruh materi pada situs ini, termasuk logo, nama perusahaan, desain tampilan, dan tulisan pada blog, merupakan milik PT Karya Cipta Solusi atau digunakan dengan izin yang sah.',
      'Anda diperbolehkan membaca, membagikan tautan, dan mengutip sebagian isi artikel kami untuk keperluan wajar dengan tetap mencantumkan sumbernya. Menyalin keseluruhan isi untuk diterbitkan ulang sebagai milik pihak lain tidak diperkenankan tanpa izin tertulis dari kami.',
      'Hak atas hasil pekerjaan yang kami buat untuk klien diatur tersendiri dalam perjanjian kerja sama. Sebagaimana kebijakan kami, source code dan dokumentasi hasil pekerjaan menjadi milik klien setelah pelunasan.',
    ],
  },
  {
    heading: '6. Penggunaan yang Tidak Diperkenankan',
    paragraphs: ['Saat menggunakan situs ini, Anda setuju untuk tidak melakukan hal-hal berikut:'],
    bullets: [
      'Mencoba mengakses bagian situs, sistem, atau data yang bukan diperuntukkan bagi publik.',
      'Mengganggu atau mencoba mengganggu kelancaran operasional situs dan layanan kami.',
      'Mengirimkan konten yang melanggar hukum, menyesatkan, atau merugikan pihak lain melalui formulir maupun kanal komunikasi kami.',
      'Menggunakan identitas orang lain atau memberikan informasi palsu saat menghubungi kami.',
      'Menggunakan isi situs ini untuk tujuan yang melanggar peraturan perundang-undangan yang berlaku.',
    ],
  },
  {
    heading: '7. Tautan ke Situs Pihak Ketiga',
    paragraphs: [
      'Situs kami dapat memuat tautan ke layanan pihak ketiga, misalnya WhatsApp, Google Maps, atau platform media sosial. Kami tidak mengendalikan dan tidak bertanggung jawab atas isi maupun kebijakan privasi layanan pihak ketiga tersebut. Penggunaan layanan tersebut tunduk pada ketentuan masing-masing penyedianya.',
    ],
  },
  {
    heading: '8. Ketersediaan Situs',
    paragraphs: [
      'Kami berupaya menjaga situs ini dapat diakses sepanjang waktu. Namun, akses dapat terganggu sementara karena pemeliharaan, pembaruan, atau kendala teknis di luar kendali kami. Kami tidak memberikan jaminan bahwa situs akan bebas gangguan atau bebas dari kesalahan teknis setiap saat.',
    ],
  },
  {
    heading: '9. Batasan Tanggung Jawab',
    paragraphs: [
      'Sejauh diperkenankan oleh hukum yang berlaku, PT Karya Cipta Solusi tidak bertanggung jawab atas kerugian tidak langsung yang timbul dari penggunaan situs ini, termasuk kerugian akibat keputusan yang diambil semata-mata berdasarkan informasi umum yang tersedia di sini.',
      'Tanggung jawab kami atas pekerjaan yang kami kerjakan untuk klien diatur dalam perjanjian kerja sama masing-masing, termasuk ketentuan mengenai garansi perbaikan setelah pekerjaan diserahterimakan.',
    ],
  },
  {
    heading: '10. Perlindungan Data Pribadi',
    paragraphs: [
      'Pengelolaan data pribadi Anda dijelaskan secara terpisah dalam Kebijakan Privasi kami, yang merupakan bagian tidak terpisahkan dari syarat dan ketentuan ini.',
    ],
  },
  {
    heading: '11. Perubahan Ketentuan',
    paragraphs: [
      'Kami dapat memperbarui syarat dan ketentuan ini dari waktu ke waktu. Versi terbaru selalu tersedia di halaman ini beserta tanggal pembaruannya. Dengan tetap menggunakan situs setelah pembaruan, Anda dianggap menyetujui ketentuan yang berlaku saat itu.',
    ],
  },
  {
    heading: '12. Hukum yang Berlaku dan Penyelesaian Perselisihan',
    paragraphs: [
      'Syarat dan ketentuan ini tunduk pada hukum Republik Indonesia. Apabila timbul perselisihan, kedua pihak sepakat untuk terlebih dahulu menyelesaikannya secara musyawarah. Bila musyawarah tidak mencapai kesepakatan, penyelesaian ditempuh melalui jalur hukum yang berlaku di wilayah Republik Indonesia.',
    ],
  },
  {
    heading: '13. Menghubungi Kami',
    paragraphs: [
      'Pertanyaan mengenai syarat dan ketentuan ini dapat disampaikan melalui email pt.karyaciptasolusi@gmail.com atau WhatsApp 0838-9891-1244.',
    ],
  },
];

export default function SyaratKetentuan() {
  usePageMeta({
    title: 'Syarat & Ketentuan | PT Karya Cipta Solusi',
    description:
      'Syarat dan ketentuan penggunaan situs serta layanan PT Karya Cipta Solusi, termasuk ketentuan penawaran, kekayaan intelektual, dan batasan tanggung jawab.',
    canonicalPath: '/syarat-ketentuan',
  });

  return (
    <LegalPage
      title="Syarat & Ketentuan"
      intro="Ketentuan penggunaan situs karyaciptasolusi.com dan gambaran umum ketentuan layanan kami. Dibuat agar hubungan kerja sama kita jelas sejak awal."
      updatedAt={UPDATED}
      sections={sections}
      footerNote="Dokumen ini mengatur penggunaan situs secara umum. Ketentuan yang mengikat untuk sebuah proyek tetap mengacu pada perjanjian kerja sama tertulis antara Anda dan kami."
    >
      <div className="mb-10 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5">
        <p className="text-sm text-[#334155] leading-relaxed">
          Dokumen terkait:{' '}
          <Link to="/kebijakan-privasi" className="font-bold text-[#1D4ED8] hover:underline">
            Kebijakan Privasi
          </Link>{' '}
          dan{' '}
          <Link to="/penghapusan-data" className="font-bold text-[#1D4ED8] hover:underline">
            Penghapusan Data Pengguna
          </Link>
          .
        </p>
      </div>
    </LegalPage>
  );
}

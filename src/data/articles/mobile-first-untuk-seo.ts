import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "mobile-first-untuk-seo",
  title: "Mobile-First: Kenapa Tampilan di HP Menentukan Ranking Anda",
  excerpt: "Google menilai website terutama dari versi HP-nya. Ini yang perlu Anda periksa agar tampilan mobile tidak diam-diam merugikan bisnis Anda.",
  category: "SEO",
  date: "1 Februari 2026",
  isoDate: "2026-02-01",
  readTime: "5 menit",
  image: "/images/blog/seo-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Ada kesenjangan yang jarang disadari pemilik bisnis: Anda memeriksa website dari layar laptop yang lebar, sementara sebagian besar calon pelanggan membukanya dari HP sambil berjalan atau menunggu antrean. Tampilan yang Anda banggakan belum tentu tampilan yang mereka lihat. Dan sejak Google mengutamakan versi seluler dalam penilaiannya, kesenjangan ini bukan lagi soal selera — ia ikut menentukan apakah website Anda muncul atau tidak.' },
  { type: 'h2', text: 'Apa Arti Mobile-First Indexing' },
  { type: 'p', text: 'Secara sederhana, Google menjadikan versi seluler halaman Anda sebagai acuan utama ketika merayapi dan mengindeks. Artinya, kalau versi HP menampilkan lebih sedikit isi daripada versi desktop — misalnya sebagian teks sengaja disembunyikan, gambar tidak dimuat, atau bagian penting dipotong demi ringkas — maka versi yang lebih miskin itulah yang dinilai. Website bisa terlihat lengkap di laptop tetapi dinilai seadanya oleh Google.' },
  { type: 'h2', text: 'Responsif Bukan Sekadar Mengecil' },
  { type: 'p', text: 'Banyak website mengaku sudah responsif hanya karena tampilannya menyusut mengikuti lebar layar. Padahal yang menentukan bukan itu, melainkan apakah halaman tetap nyaman dipakai dengan jempol di layar kecil.' },
  { type: 'ul', items: [
    'Ukuran huruf tetap terbaca tanpa perlu diperbesar dengan dua jari.',
    'Tombol dan tautan cukup besar serta tidak berdempetan sehingga tidak mudah salah tekan.',
    'Formulir dibuat sependek mungkin, dengan jenis papan ketik yang sesuai — angka untuk nomor telepon, misalnya.',
    'Tidak ada elemen yang melewati batas layar sehingga halaman harus digeser ke samping.',
    'Pop-up tidak langsung menutupi isi utama begitu halaman terbuka.',
    'Nomor telepon dan WhatsApp bisa langsung ditekan, bukan sekadar teks yang harus disalin manual.',
  ] },
  { type: 'h2', text: 'Isi Harus Sama, Bukan Versi Ringkas' },
  { type: 'p', text: 'Godaan terbesar saat merapikan tampilan HP adalah membuang teks agar halaman terlihat lebih bersih. Sebaiknya jangan. Kalau sebuah penjelasan penting untuk meyakinkan pembeli di desktop, ia sama pentingnya di HP. Bila memang perlu diringkas secara tampilan, gunakan bagian yang bisa dibuka-tutup — isinya tetap ada, hanya tidak semuanya tampil sekaligus.' },
  { type: 'p', text: 'Hal yang sama berlaku untuk judul, gambar utama, dan data bisnis seperti alamat dan jam operasional. Semuanya sebaiknya hadir utuh di versi seluler.' },
  { type: 'h2', text: 'Cara Menguji Sendiri dalam Sepuluh Menit' },
  { type: 'ul', items: [
    'Buka website Anda memakai data seluler, bukan WiFi kantor, agar terasa kondisi sebenarnya.',
    'Coba dari HP kelas menengah, bukan hanya perangkat terbaru milik Anda.',
    'Gunakan mode perangkat di browser desktop untuk mengecek beberapa ukuran layar sekaligus.',
    'Selesaikan satu alur penting sampai tuntas: cari layanan, buka halamannya, lalu coba menghubungi seolah Anda calon pelanggan.',
  ] },
  { type: 'p', text: 'Langkah terakhir itu yang paling sering membuka mata. Banyak masalah baru terlihat ketika seseorang benar-benar mencoba menghubungi, bukan sekadar melihat-lihat tampilan. Bila hasil pengujian Anda menemukan hal yang sulit diperbaiki tanpa menyentuh kode, PT Karya Cipta Solusi terbuka untuk membahas temuan Anda lewat konsultasi gratis dan menilai seberapa besar perbaikan yang sebenarnya dibutuhkan.' },
];

export default content;

import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-web-app-progresif-offline",
  title: "Kenapa Beberapa Website Tetap Jalan Saat Sinyal Lemah",
  excerpt: "Sebagian website langsung gagal begitu sinyal hilang, sebagian tetap terbuka. Pahami mekanisme di baliknya dan kapan kemampuan ini layak dibangun untuk bisnis Anda.",
  category: "Teknologi",
  date: "3 Februari 2026",
  isoDate: "2026-02-03",
  readTime: "5 menit",
  image: "/images/blog/teknologi-4.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Di dalam lift, di basement parkir, atau di jalan antar kota, sinyal sering menghilang. Sebagian besar website langsung menampilkan pesan gagal terhubung. Tapi ada juga aplikasi berbasis web yang tetap terbuka, isinya masih bisa dibaca, bahkan formulirnya masih bisa diisi. Kenapa bisa berbeda? Jawabannya berguna untuk siapa pun yang punya pelanggan atau staf di lapangan.' },
  { type: 'h2', text: 'Kuncinya: Menyimpan Salinan Lebih Dulu' },
  { type: 'p', text: 'Orang yang hendak menempuh perjalanan jauh membawa bekal, karena tahu tidak semua ruas jalan ada warung. Website yang tahan sinyal lemah bekerja dengan naluri yang sama. Saat koneksi masih bagus, ia diam-diam menyimpan salinan tampilan dan data yang kemungkinan besar akan dibutuhkan. Ketika koneksi terputus, salinan itulah yang ditampilkan, sehingga pengguna tidak berhadapan dengan layar kosong.' },
  { type: 'h2', text: 'Petugas Kecil yang Berjaga di Latar Belakang' },
  { type: 'p', text: 'Mekanismenya dijalankan oleh komponen bernama service worker. Anda bisa membayangkannya sebagai petugas yang berdiri di pintu antara aplikasi dan internet. Setiap kali halaman membutuhkan sesuatu, petugas ini yang menangani permintaannya. Kalau internet tersedia, ia mengambil versi terbaru dari server. Kalau tidak, ia mengambil dari lemari salinan yang sudah disiapkan sebelumnya.' },
  { type: 'p', text: 'Karena berjalan di latar belakang, pengguna tidak menyadari kehadirannya. Yang mereka rasakan hanya satu hal: aplikasinya tetap terbuka dan terasa cepat, bahkan ketika sinyal sedang buruk.' },
  { type: 'h2', text: 'Antrean yang Dikirim Belakangan' },
  { type: 'p', text: 'Kemampuan kedua yang tak kalah berguna adalah menunda pengiriman. Bayangkan surat yang ditulis malam hari lalu dimasukkan ke tas, dan baru dikirim keesokan pagi saat kantor pos buka. Dengan cara serupa, data yang diisi pengguna saat offline disimpan dulu di perangkat, lalu dikirim otomatis begitu koneksi pulih.' },
  { type: 'p', text: 'Bagi bisnis, ini yang membuat perbedaan nyata. Petugas survei bisa terus mengisi formulir di daerah tanpa sinyal. Kurir bisa mencatat bukti pengantaran di lorong gedung. Tenaga penjualan bisa mencatat pesanan di pasar yang jaringannya padat. Tidak ada pekerjaan yang hilang hanya karena sinyal sedang tidak bersahabat.' },
  { type: 'h2', text: 'Apa yang Tetap Tidak Bisa Dikerjakan Offline' },
  { type: 'p', text: 'Penting untuk tidak menjanjikan lebih dari yang mungkin. Ada hal yang secara mendasar memerlukan koneksi:' },
  { type: 'ul', items: [
    'Pembayaran dan verifikasi transaksi yang harus dikonfirmasi pihak lain.',
    'Data yang harus akurat saat itu juga, seperti sisa stok atau ketersediaan kursi.',
    'Percakapan langsung dengan pihak lain, termasuk chat dan panggilan.',
    'Halaman atau data yang belum pernah dibuka sebelumnya, karena salinannya memang belum ada.',
    'Proses masuk untuk pertama kalinya di perangkat baru.',
  ] },
  { type: 'p', text: 'Ada juga risiko yang perlu diantisipasi: data yang ditampilkan bisa sudah usang, dan bila dua orang mengubah catatan yang sama saat sama-sama offline, perlu ada aturan jelas versi mana yang menang saat keduanya kembali daring.' },
  { type: 'h2', text: 'Kapan Kemampuan Ini Layak Dibangun' },
  { type: 'ul', items: [
    'Tim lapangan seperti kurir, teknisi, sales, atau surveyor yang sering bekerja di lokasi bersinyal buruk.',
    'Sistem kasir di lokasi dengan jaringan yang naik-turun, di mana transaksi tidak boleh berhenti.',
    'Katalog produk atau dokumentasi internal yang isinya jarang berubah tapi sering dibuka.',
    'Aplikasi yang dipakai berulang kali setiap hari, karena salinan lokal juga membuatnya terasa jauh lebih cepat.',
  ] },
  { type: 'p', text: 'Sebaliknya, kalau seluruh pengguna Anda bekerja di kantor dengan jaringan stabil dan hanya membuka sistem sesekali, kemampuan ini bisa ditaruh di prioritas bawah. Cara paling jujur menilainya adalah bertanya: kalau koneksi mati lima belas menit, pekerjaan siapa yang berhenti? Jawaban atas pertanyaan itu menentukan apakah investasi ini sepadan untuk Anda.' },
];

export default content;

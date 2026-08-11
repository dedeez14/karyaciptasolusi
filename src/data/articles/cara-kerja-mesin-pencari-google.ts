import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "cara-kerja-mesin-pencari-google",
  title: "Bagaimana Google Menemukan dan Menilai Website Anda",
  excerpt: "Pahami tiga tahap kerja Google — merayapi, mengindeks, dan memeringkat — supaya Anda tahu kenapa sebuah halaman bisa tidak muncul sama sekali di pencarian.",
  category: "SEO",
  date: "23 Juli 2026",
  isoDate: "2026-07-23",
  readTime: "6 menit",
  image: "/images/blog/seo-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Banyak pemilik website bingung: sudah online berbulan-bulan, tetapi mengetik nama bisnisnya sendiri di Google pun tidak membuahkan hasil. Sebelum bicara strategi apa pun, ada baiknya memahami dulu bagaimana Google bekerja. Prosesnya bisa disederhanakan menjadi tiga tahap yang berurutan, dan masalah biasanya terjadi di salah satu tahap tersebut.' },
  { type: 'h2', text: 'Tahap Pertama: Merayapi' },
  { type: 'p', text: 'Google menjalankan program otomatis yang biasa disebut crawler atau bot. Tugasnya menyusuri internet dengan mengikuti tautan dari satu halaman ke halaman lain, mirip kurir yang berpindah alamat mengikuti papan penunjuk jalan. Kalau tidak ada satu pun tautan yang mengarah ke halaman Anda, dan Anda juga tidak pernah memberi tahu keberadaannya, halaman itu bisa terlewat begitu saja.' },
  { type: 'p', text: 'Ada dua cara sederhana untuk membantu proses ini. Pertama, membuat sitemap — sebuah berkas berisi daftar isi seluruh halaman website Anda — lalu mengirimkannya lewat Google Search Console. Kedua, memastikan setiap halaman penting bisa dijangkau dari menu atau dari halaman lain, bukan halaman yatim yang hanya bisa dibuka kalau Anda tahu alamat persisnya.' },
  { type: 'h2', text: 'Tahap Kedua: Mengindeks' },
  { type: 'p', text: 'Setelah halaman ditemukan, Google membaca isinya lalu menyimpannya di dalam indeks — semacam katalog raksasa. Di tahap ini Google mencoba memahami halaman itu membahas apa dan cocok untuk siapa. Yang sering disalahpahami: ditemukan tidak otomatis berarti diindeks. Google boleh saja memutuskan sebuah halaman tidak layak masuk katalog.' },
  { type: 'p', text: 'Beberapa penyebab yang paling sering membuat halaman gagal diindeks:' },
  { type: 'ul', items: [
    'Halaman diblokir lewat berkas robots.txt atau tag noindex yang tertinggal sejak masa pengembangan website.',
    'Isi halaman terlalu tipis, atau nyaris sama persis dengan halaman lain di website yang sama.',
    'Halaman masih sangat baru dan belum ada satu pun tautan menuju ke sana.',
    'Website perlu waktu muat sangat lama sehingga proses pembacaan terganggu.',
    'Struktur website berlapis-lapis sehingga halaman terkubur terlalu dalam dari halaman utama.',
  ] },
  { type: 'h2', text: 'Tahap Ketiga: Memeringkat' },
  { type: 'p', text: 'Ketika seseorang mengetik pencarian, Google memilih dari indeksnya halaman mana yang paling relevan, lalu mengurutkannya. Pertimbangannya sangat banyak dan tidak pernah dipublikasikan secara rinci. Namun arah besarnya konsisten dari tahun ke tahun: seberapa cocok halaman itu dengan maksud si pencari, seberapa lengkap dan bermanfaat isinya, seberapa nyaman halaman itu dipakai, dan seberapa dipercaya sumbernya.' },
  { type: 'p', text: 'Untuk pencarian yang berhubungan dengan tempat — misalnya "bengkel terdekat" — lokasi orang yang mencari ikut menentukan hasil. Itulah kenapa bisnis lokal perlu memperlakukan profil bisnis dan informasi alamat sebagai bagian penting dari pekerjaan SEO, bukan pelengkap.' },
  { type: 'h2', text: 'Kenapa Hasil Pencarian Tiap Orang Bisa Berbeda' },
  { type: 'p', text: 'Mengecek posisi dengan mengetik kata kunci di HP sendiri adalah cara yang paling menyesatkan. Hasil yang Anda lihat dipengaruhi lokasi Anda, perangkat yang dipakai, riwayat pencarian, dan bahkan akun yang sedang aktif. Wajar kalau Anda melihat website sendiri di posisi atas sementara calon pelanggan di kota lain tidak menemukannya sama sekali.' },
  { type: 'p', text: 'Sumber yang lebih jujur adalah Google Search Console, karena datanya berasal dari Google sendiri dan menunjukkan posisi rata-rata dari banyak pencarian nyata. Kalau website Anda belum terhubung ke sana, itu langkah pertama yang paling layak dikerjakan minggu ini — sebelum memikirkan taktik apa pun.' },
];

export default content;

import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "istilah-website-untuk-pemilik-bisnis",
  title: "20+ Istilah Dunia Website yang Wajib Diketahui Pemilik Bisnis",
  excerpt: "Kamus ringkas istilah website dalam bahasa sederhana, supaya Anda tidak lagi bingung membaca penawaran atau berdiskusi dengan tim teknis.",
  category: "Panduan",
  date: "3 Maret 2026",
  isoDate: "2026-03-03",
  readTime: "7 menit",
  image: "/images/blog/panduan-3.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Rapat dengan tim teknis sering terasa seperti mendengarkan bahasa asing. Muncul kata-kata seperti CDN, cache, responsive, atau bounce rate, dan Anda ragu bertanya karena takut terlihat tidak paham. Padahal memahami istilah dasar membuat Anda bisa menilai penawaran dengan lebih adil dan berdiskusi setara. Berikut kamus ringkas yang dikelompokkan agar mudah dicerna.' },
  { type: 'h2', text: 'Istilah Dasar: Alamat dan Tempat Tinggal Website' },
  { type: 'ul', items: [
    'Domain: alamat website Anda yang diketik orang di browser, misalnya namabisnis.com.',
    'Hosting: layanan penyewaan ruang di server tempat seluruh berkas website disimpan.',
    'Server: komputer yang menyala terus-menerus dan bertugas melayani permintaan pengunjung.',
    'DNS: sistem yang menerjemahkan nama domain menjadi lokasi server sebenarnya, mirip buku alamat internet.',
    'SSL: pengaman yang mengacak data antara pengunjung dan website, ditandai alamat berawalan https.',
    'Bandwidth: jumlah data yang mengalir dari website Anda ke pengunjung dalam periode tertentu.',
    'Uptime: persentase waktu website berhasil diakses tanpa gangguan.',
  ] },
  { type: 'h2', text: 'Istilah Tampilan dan Pengalaman Pengguna' },
  { type: 'ul', items: [
    'Responsive: kemampuan tampilan website menyesuaikan diri dengan ukuran layar ponsel, tablet, maupun laptop.',
    'UI: sisi tampilan yang dilihat dan disentuh pengunjung, seperti tombol, warna, dan tata letak.',
    'UX: pengalaman menyeluruh saat memakai website, termasuk seberapa mudah pengunjung menemukan yang dicari.',
    'Wireframe: sketsa kasar tata letak halaman tanpa warna dan gambar, dipakai untuk menyepakati struktur lebih dulu.',
    'Mockup: gambaran visual halaman yang sudah bergaya lengkap namun belum berfungsi.',
    'Above the fold: bagian halaman yang langsung terlihat sebelum pengunjung menggulir layar.',
    'CTA: ajakan bertindak, biasanya berupa tombol seperti Hubungi Kami atau Pesan Sekarang.',
  ] },
  { type: 'h2', text: 'Istilah Teknis Pengembangan' },
  { type: 'ul', items: [
    'Frontend: bagian website yang berjalan di perangkat pengunjung dan langsung terlihat.',
    'Backend: bagian yang bekerja di balik layar, mengurus data dan aturan logika.',
    'Database: tempat data tersimpan rapi, misalnya daftar produk, pesanan, dan akun pengguna.',
    'API: jembatan yang memungkinkan dua sistem berbeda saling bertukar data secara otomatis.',
    'Source code: kumpulan kode program penyusun website Anda.',
    'Staging: salinan website untuk uji coba perubahan sebelum diterapkan ke versi yang dilihat publik.',
    'Cache: penyimpanan sementara agar halaman yang sudah pernah dibuka bisa tampil lebih cepat.',
    'CDN: jaringan server di berbagai lokasi yang menyajikan berkas dari titik terdekat dengan pengunjung.',
  ] },
  { type: 'h2', text: 'Istilah Pemasaran dan Pengukuran' },
  { type: 'ul', items: [
    'SEO: upaya agar website lebih mudah ditemukan di hasil pencarian tanpa membayar iklan.',
    'Traffic: jumlah kunjungan yang masuk ke website Anda.',
    'Conversion: kejadian saat pengunjung melakukan tindakan yang Anda harapkan, misalnya mengisi formulir.',
    'Bounce rate: proporsi pengunjung yang pergi setelah melihat satu halaman saja tanpa berinteraksi.',
    'Landing page: halaman khusus yang dirancang untuk satu tujuan tunggal, sering dipakai untuk kampanye iklan.',
    'Analytics: alat pencatat perilaku pengunjung yang menunjukkan halaman mana yang ramai dan dari mana asal kunjungan.',
    'Backlink: tautan dari website lain yang mengarah ke website Anda.',
  ] },
  { type: 'p', text: 'Anda tidak perlu menghafal semuanya sekaligus. Cukup simpan halaman ini dan buka kembali saat sedang membaca proposal atau menyiapkan pertanyaan sebelum rapat. Satu kebiasaan kecil yang sangat membantu: setiap kali ada istilah asing di sebuah penawaran, minta penjelasannya dalam satu kalimat sederhana. Penyedia jasa yang baik akan dengan senang hati menerjemahkannya, dan cara mereka menjelaskan sudah cukup memberi tahu Anda banyak hal.' },
];

export default content;

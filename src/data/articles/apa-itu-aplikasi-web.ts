import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-aplikasi-web",
  title: "Apa Itu Aplikasi Web dan Bedanya dengan Website Biasa",
  excerpt: "Pahami perbedaan website biasa dan aplikasi web, dari cara kerjanya hingga tanda bahwa bisnis Anda butuh aplikasi, bukan sekadar halaman profil.",
  category: "Aplikasi",
  date: "4 Agustus 2026",
  isoDate: "2026-08-04",
  readTime: "5 menit",
  image: "/images/blog/aplikasi-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Banyak pemilik bisnis memakai kata website dan aplikasi secara bergantian. Wajar saja, keduanya dibuka lewat browser dan sama-sama punya alamat internet. Tetapi keduanya bekerja berbeda, dibangun dengan usaha yang berbeda, dan menyelesaikan masalah yang berbeda pula. Memahami bedanya membuat Anda tidak salah memesan, dan tidak salah menganggarkan.' },
  { type: 'h2', text: 'Website Biasa: Etalase yang Menyampaikan Informasi' },
  { type: 'p', text: 'Website biasa, yang sering disebut company profile, berfungsi seperti brosur digital. Isinya relatif tetap: profil perusahaan, daftar layanan, portofolio, artikel, dan kontak. Pengunjung datang, membaca, lalu menghubungi Anda lewat telepon atau pesan. Perubahan isi dilakukan sesekali oleh Anda atau tim, bukan oleh pengunjung.' },
  { type: 'p', text: 'Pola interaksinya pada dasarnya satu arah. Website tidak perlu mengingat siapa yang datang kemarin dan tidak menyimpan hasil pekerjaan pengunjung. Karena itu fokus pembuatannya ada pada desain, kualitas konten, kecepatan, dan agar mudah ditemukan di mesin pencari.' },
  { type: 'h2', text: 'Aplikasi Web: Alat Kerja yang Menyimpan dan Mengolah Data' },
  { type: 'p', text: 'Aplikasi web juga dibuka lewat browser, tetapi perilakunya seperti software. Ada akun pengguna, ada data yang tersimpan, dan ada proses yang berjalan di dalamnya. Contoh yang sering ditemui: sistem reservasi, dashboard laporan penjualan, aplikasi absensi karyawan, atau portal tempat pelanggan memeriksa status pesanan mereka sendiri.' },
  { type: 'p', text: 'Ciri-ciri sebuah kebutuhan sudah masuk kategori aplikasi web biasanya seperti ini:' },
  { type: 'ul', items: [
    'Setiap pengguna masuk dengan akun sendiri dan melihat data yang berbeda satu sama lain.',
    'Data yang dimasukkan tersimpan permanen dan bisa diolah menjadi laporan.',
    'Ada aturan bisnis di dalamnya: perhitungan otomatis, persetujuan bertingkat, atau perubahan status pesanan.',
    'Ada pembagian hak akses antara pemilik, staf, dan pelanggan.',
    'Isinya berubah setiap hari karena dipakai bekerja, bukan hanya saat Anda memperbarui konten.',
  ] },
  { type: 'h2', text: 'Kenapa Perbedaan Ini Berpengaruh pada Biaya dan Waktu' },
  { type: 'p', text: 'Pada website biasa, sebagian besar pekerjaan berhenti setelah tampilan selesai dan konten terpasang. Pada aplikasi web, tampilan justru baru permulaan. Di baliknya perlu dirancang struktur penyimpanan data, alur perpindahan status, pengamanan akun, serta pengujian untuk berbagai kemungkinan tindakan pengguna. Satu tombol sederhana bisa berarti beberapa aturan yang harus diperiksa satu per satu.' },
  { type: 'p', text: 'Karena itu wajar bila waktu pengerjaan dan biayanya berbeda jauh, meskipun dari luar keduanya sama-sama terlihat sebagai halaman di browser.' },
  { type: 'h2', text: 'Bagaimana Menentukan Mana yang Anda Butuhkan' },
  { type: 'ul', items: [
    'Jika tujuan utamanya membuat bisnis ditemukan dan dipercaya calon pelanggan, website biasa umumnya sudah cukup.',
    'Jika ada pekerjaan berulang yang kini dicatat di kertas atau spreadsheet, kemungkinan besar Anda butuh aplikasi.',
    'Jika pelanggan sering menanyakan status, riwayat, atau sisa saldo mereka, itu pekerjaan yang bisa diambil alih aplikasi.',
    'Jika beberapa orang harus bekerja pada data yang sama tanpa saling menimpa, spreadsheet akan cepat kewalahan.',
    'Keduanya bisa hidup berdampingan: website sebagai pintu depan, aplikasi sebagai ruang kerja di baliknya.',
  ] },
  { type: 'p', text: 'Langkah pertama yang paling berguna bukan memilih teknologi, melainkan menulis daftar pekerjaan yang ingin Anda permudah. Tuliskan siapa yang mengerjakannya, berapa lama waktunya, dan di mana datanya sekarang tersimpan. Daftar sesederhana itu biasanya sudah cukup untuk menjawab sendiri apakah yang Anda butuhkan adalah website, aplikasi, atau keduanya secara bertahap.' },
];

export default content;

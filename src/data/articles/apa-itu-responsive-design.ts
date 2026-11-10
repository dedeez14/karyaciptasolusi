import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-responsive-design",
  title: "Responsive Design: Satu Website untuk Semua Ukuran Layar",
  excerpt: "Website yang harus dizoom di HP membuat calon pelanggan pergi. Pahami apa itu responsive design, tandanya bila website Anda belum responsif, dan dampaknya ke penjualan.",
  category: "Teknologi",
  date: "26 Mei 2026",
  isoDate: "2026-05-26",
  readTime: "4 menit",
  image: "/images/blog/teknologi-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Coba buka website bisnis Anda dari HP sendiri, bukan dari layar komputer kantor. Apakah tulisannya terbaca tanpa harus dicubit untuk memperbesar? Apakah tombol pemesanan mudah ditekan dengan ibu jari? Kalau jawabannya tidak, Anda sedang kehilangan pengunjung setiap hari tanpa menyadarinya. Di sinilah istilah responsive design menjadi relevan.' },
  { type: 'h2', text: 'Air yang Mengikuti Bentuk Wadahnya' },
  { type: 'p', text: 'Responsive design berarti tampilan website menyesuaikan diri dengan ukuran layar yang dipakai untuk membukanya. Bayangkan air yang dituang ke gelas, botol, atau mangkuk. Isinya sama, tapi bentuknya mengikuti wadah. Begitulah website responsif bekerja: satu website, satu alamat, satu isi, tapi susunannya berubah agar tetap nyaman dibaca di layar besar maupun kecil.' },
  { type: 'p', text: 'Dulu sebagian perusahaan membuat versi terpisah khusus untuk HP dengan alamat berbeda. Cara itu ditinggalkan karena merepotkan: setiap perubahan harus dikerjakan dua kali dan sering ada isi yang tertinggal di salah satu versi. Pendekatan modern menyatukan keduanya.' },
  { type: 'h2', text: 'Tanda Website Anda Belum Responsif' },
  { type: 'ul', items: [
    'Anda harus memperbesar layar dengan dua jari agar tulisan terbaca.',
    'Halaman bisa digeser ke kiri dan kanan, seolah ada bagian yang meluber keluar layar.',
    'Tombol terlalu kecil atau terlalu berdekatan sehingga sering salah tekan.',
    'Gambar terpotong atau justru menutupi teks di sebelahnya.',
    'Menu navigasi tidak bisa dibuka atau menutupi seluruh isi halaman.',
    'Formulir sulit diisi karena kolomnya sempit atau keyboard menutupi kolom yang sedang aktif.',
  ] },
  { type: 'h2', text: 'Apa Saja yang Diatur agar Tampilan Menyesuaikan' },
  { type: 'p', text: 'Membuat website responsif bukan sekadar mengecilkan semua elemen. Ada beberapa hal yang dipikirkan ulang khusus untuk layar kecil:' },
  { type: 'ul', items: [
    'Ukuran teks yang tetap nyaman dibaca tanpa perlu diperbesar.',
    'Jarak antar tombol yang cukup agar mudah ditekan dengan jari, bukan dengan kursor.',
    'Gambar yang otomatis menyesuaikan lebar layar dan tidak memakan kuota berlebihan.',
    'Tabel panjang yang bisa digeser sendiri di dalam kotaknya, bukan mendorong seluruh halaman.',
    'Menu yang berubah bentuk menjadi ringkas agar tidak memakan ruang layar.',
    'Urutan konten yang diatur ulang sehingga informasi terpenting muncul lebih dulu.',
  ] },
  { type: 'h2', text: 'Dampaknya ke Penjualan dan Posisi di Pencarian' },
  { type: 'p', text: 'Sebagian besar orang di Indonesia mengakses internet dari ponsel. Kalau pengalaman di HP menyulitkan, calon pembeli tidak akan mengeluh — mereka hanya menutup halaman dan membuka pesaing Anda. Kerugiannya diam-diam dan sulit terlihat di laporan.' },
  { type: 'p', text: 'Selain itu, mesin pencari menilai kualitas website terutama dari versi ponselnya. Website yang sulit dipakai di layar kecil punya peluang lebih kecil untuk muncul di posisi atas hasil pencarian. Jadi tampilan responsif bukan urusan estetika semata, melainkan menyangkut apakah bisnis Anda ditemukan atau tidak.' },
  { type: 'h2', text: 'Langkah Pertama yang Bisa Anda Lakukan Hari Ini' },
  { type: 'p', text: 'Ambil HP Anda, buka website bisnis Anda, lalu coba selesaikan satu tugas seperti seorang pelanggan: cari informasi harga, isi formulir kontak, atau masukkan satu produk ke keranjang. Perhatikan di titik mana Anda merasa terganggu. Catat semuanya, sekecil apa pun. Daftar sederhana itu biasanya sudah cukup menjadi bahan perbaikan pertama, dan lebih berguna daripada menebak-nebak dari layar komputer.' },
];

export default content;

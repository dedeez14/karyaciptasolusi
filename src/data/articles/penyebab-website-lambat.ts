import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "penyebab-website-lambat",
  title: "10 Penyebab Website Lambat dan Cara Mengatasinya",
  excerpt: "Website lambat membuat pengunjung pergi sebelum melihat isinya. Kenali sepuluh penyebab paling umum beserta langkah perbaikan yang bisa langsung dicoba.",
  category: "Tips",
  date: "24 Mei 2026",
  isoDate: "2026-05-24",
  readTime: "7 menit",
  image: "/images/blog/tips-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Pengunjung website tidak sabar, apalagi yang membuka lewat data seluler sambil berjalan. Kalau halaman terasa menggantung, sebagian besar dari mereka akan menutupnya sebelum melihat apa yang Anda tawarkan. Kabar baiknya, penyebab website lambat biasanya berulang dan sebagian bisa diperbaiki tanpa menulis satu baris kode pun. Berikut sepuluh penyebab yang paling sering ditemui.' },
  { type: 'h2', text: 'Ukur Dulu Sebelum Menebak' },
  { type: 'p', text: 'Sebelum memperbaiki apa pun, ukur kondisi sekarang supaya Anda punya pembanding. Ada alat pengukur kecepatan halaman gratis dari mesin pencari maupun penyedia independen; masukkan alamat halaman Anda dan simpan hasilnya. Lakukan juga tes manual paling jujur: buka website Anda di ponsel dengan data seluler, bukan di komputer kantor dengan wifi kencang.' },
  { type: 'h2', text: 'Penyebab dari Sisi Isi Halaman' },
  { type: 'p', text: 'Empat penyebab pertama datang dari materi yang Anda unggah sendiri, dan justru di sinilah perbaikan paling cepat terasa.' },
  { type: 'ul', items: [
    'Gambar berukuran raksasa. Foto langsung dari kamera ponsel sering berukuran beberapa megabyte. Perkecil dimensinya dan kompres sebelum diunggah.',
    'Terlalu banyak gambar di layar pertama, terutama slider berisi banyak foto besar. Cukup satu gambar utama yang kuat.',
    'Video yang diputar otomatis atau ditanam langsung di halaman depan. Ganti dengan gambar sampul yang baru memuat video saat diklik.',
    'Dokumen dan file mentah yang ditaruh apa adanya, misalnya brosur PDF puluhan megabyte. Kompres file atau tautkan ke penyimpanan terpisah.',
  ] },
  { type: 'h2', text: 'Penyebab dari Sisi Server dan Pengaturan' },
  { type: 'p', text: 'Tiga penyebab berikutnya berkaitan dengan tempat website Anda tinggal. Bagian ini biasanya perlu bantuan penyedia hosting atau developer, tapi Anda tetap perlu tahu apa yang harus ditanyakan.' },
  { type: 'ul', items: [
    'Hosting bersama yang terlalu padat. Kalau server dipakai ramai-ramai dan sumber dayanya kecil, semua website di dalamnya ikut melambat. Tanyakan opsi paket yang lebih lapang atau pindah penyedia.',
    'Tidak ada caching. Caching membuat server menyimpan hasil halaman yang sudah pernah dibuat, sehingga kunjungan berikutnya tidak perlu menyusun ulang dari nol. Aktifkan caching di sisi server dan browser.',
    'Server jauh dari pengunjung dan tanpa jaringan pengantar konten. Kalau pembeli Anda di Indonesia, pilih lokasi server terdekat atau gunakan layanan yang menyalin konten ke server yang lebih dekat dengan pengunjung.',
  ] },
  { type: 'h2', text: 'Penyebab dari Sisi Tambahan dan Skrip Pihak Ketiga' },
  { type: 'p', text: 'Tiga penyebab terakhir muncul perlahan seiring waktu, biasanya karena kebiasaan menambah tanpa pernah mengurangi.' },
  { type: 'ul', items: [
    'Terlalu banyak plugin atau ekstensi. Setiap tambahan membawa berkas sendiri. Nonaktifkan yang tidak dipakai enam bulan terakhir, lalu hapus.',
    'Skrip pihak ketiga yang menumpuk: widget chat, pelacak iklan, peta tertanam, dan tampilan feed media sosial. Pertahankan yang benar-benar Anda gunakan datanya, buang sisanya.',
    'Font web dan animasi berlebihan. Batasi jumlah keluarga font, dan gunakan animasi hanya bila membantu pengunjung memahami alur.',
  ] },
  { type: 'h2', text: 'Urutan Perbaikan yang Masuk Akal' },
  { type: 'p', text: 'Jangan mengubah sepuluh hal sekaligus. Kerjakan berurutan supaya Anda tahu perbaikan mana yang memberi dampak, dan agar mudah dikembalikan bila ada yang rusak.' },
  { type: 'ul', items: [
    'Buat cadangan website sebelum mengubah apa pun',
    'Rapikan gambar dan buang media berat, karena ini paling sering menjadi biang keladinya',
    'Aktifkan caching dan kompresi di sisi server',
    'Kurangi plugin dan skrip pihak ketiga yang tidak terpakai',
    'Ukur ulang, lalu bandingkan dengan catatan hasil awal Anda',
    'Bila masih berat setelah semua langkah di atas, barulah pertimbangkan pindah hosting atau membangun ulang bagian yang bermasalah',
  ] },
  { type: 'p', text: 'Kecepatan bukan hanya urusan teknis, melainkan bagian dari pengalaman pelanggan yang paling awal mereka rasakan. Mulailah dari hal yang paling Anda kendalikan hari ini, yaitu ukuran gambar di halaman depan, lalu ukur lagi setelah sepekan.' },
];

export default content;

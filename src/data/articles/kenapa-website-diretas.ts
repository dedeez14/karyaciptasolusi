import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "kenapa-website-diretas",
  title: "Kenapa Website Bisa Diretas dan Cara Mencegahnya",
  excerpt: "Sebagian besar peretasan website tidak menyasar bisnis tertentu. Pahami celah yang paling sering ditemukan dan pencegahan yang bisa Anda mulai hari ini.",
  category: "Keamanan",
  date: "10 April 2026",
  isoDate: "2026-04-10",
  readTime: "6 menit",
  image: "/images/blog/keamanan-4.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Banyak pemilik bisnis merasa websitenya terlalu kecil dan terlalu biasa untuk menarik perhatian siapa pun. Kenyataannya, sebagian besar percobaan pembobolan website tidak menyasar bisnis tertentu. Prosesnya berjalan otomatis dan berhenti pada siapa saja yang kebetulan lengah. Artikel ini menjelaskan celah yang paling sering ditemukan dan langkah pencegahan yang realistis dijalankan oleh tim kecil sekalipun.' },
  { type: 'h2', text: 'Bukan Soal Siapa Anda, Tapi Soal Kelengahan' },
  { type: 'p', text: 'Bayangkan seseorang berjalan menyusuri kompleks perumahan sambil mencoba setiap gagang pintu. Ia tidak peduli rumah siapa yang terbuka, yang penting ada yang tidak terkunci. Begitulah gambaran sebagian besar percobaan pembobolan website: program otomatis menyisir banyak alamat sekaligus untuk menemukan yang masih memakai versi lama atau pengaturan bawaan yang tidak pernah diubah. Ukuran bisnis Anda tidak membuat Anda terlewat dari daftar, karena memang tidak ada daftar yang dipilih secara manual.' },
  { type: 'h2', text: 'Celah yang Paling Sering Ditemukan' },
  { type: 'ul', items: [
    'Perangkat lunak yang lama tidak diperbarui, mulai dari sistem website, plugin, tema, sampai versi bahasa pemrograman di server.',
    'Plugin atau tema yang sudah tidak dikembangkan lagi oleh pembuatnya tetapi masih terpasang.',
    'Password yang lemah atau dipakai ulang, terutama pada akun administrator.',
    'Terlalu banyak akun berhak akses penuh, termasuk milik vendor lama yang kerja samanya sudah berakhir.',
    'Tidak adanya autentikasi dua langkah pada akun hosting dan admin website.',
    'File instalasi, cadangan lama, atau folder uji coba yang tertinggal dan masih bisa diakses publik.',
    'Hosting yang tidak memisahkan akun antar pelanggan dengan baik.',
  ] },
  { type: 'h2', text: 'Apa yang Sebenarnya Dicari' },
  { type: 'p', text: 'Pertanyaan yang wajar muncul: apa yang mau diambil dari website profil perusahaan yang isinya hanya profil dan kontak? Ternyata cukup banyak. Server Anda bisa dipakai mengirim email spam, menampung halaman penipuan yang menyasar orang lain, menyisipkan tautan tersembunyi demi kepentingan situs lain, atau sekadar dijadikan tempat menumpang. Data pelanggan tentu bernilai, tetapi sering kali sumber daya server dan reputasi nama domain Anda yang lebih menarik. Dampaknya sama-sama merugikan: domain yang masuk daftar hitam butuh waktu lama untuk dipulihkan namanya.' },
  { type: 'h2', text: 'Pencegahan yang Realistis Dijalankan' },
  { type: 'ul', items: [
    'Jadwalkan pembaruan rutin alih-alih menunggu ada waktu luang yang tidak pernah datang.',
    'Hapus plugin, tema, dan akun yang tidak terpakai. Yang tidak ada tidak perlu dijaga.',
    'Terapkan password unik yang panjang, ditambah autentikasi dua langkah untuk seluruh akun penting.',
    'Aktifkan backup otomatis dan simpan salinannya di luar server website.',
    'Batasi hak akses sesuai peran, lalu tinjau daftarnya setiap beberapa bulan.',
    'Pilih hosting yang menyediakan pemindaian keamanan dan dukungan yang benar-benar responsif.',
    'Pastikan HTTPS aktif di seluruh halaman, bukan hanya di halaman login.',
    'Aktifkan pemberitahuan login agar Anda tahu bila ada akses dari perangkat atau lokasi yang tidak biasa.',
  ] },
  { type: 'h2', text: 'Buat Rutinitas, Jangan Andalkan Ingatan' },
  { type: 'p', text: 'Keamanan website lebih mirip merawat kendaraan daripada memasang alarm sekali seumur hidup. Tentukan satu hari dalam sebulan untuk memeriksa daftar pembaruan, memastikan backup terbaru benar-benar terbentuk, dan meninjau daftar pengguna. Tuliskan siapa yang bertanggung jawab atas masing-masing tugas itu. Rutinitas sederhana yang benar-benar dijalankan jauh lebih berguna daripada rencana keamanan rumit yang hanya tersimpan di kepala satu orang.' },
  { type: 'p', text: 'Bila website Anda sudah lama tidak diperiksa dan Anda tidak yakin harus mulai dari mana, konsultasi gratis di PT Karya Cipta Solusi bisa dipakai untuk memetakan kondisinya lebih dulu, sebelum Anda memutuskan langkah berikutnya.' },
];

export default content;

import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "pentingnya-maintenance-website",
  title: "Maintenance Website: Apa Saja yang Dikerjakan dan Kenapa Penting",
  excerpt: "Rincian pekerjaan perawatan website mulai dari pencadangan hingga pemantauan, plus risiko nyata yang muncul bila website dibiarkan tanpa pengawasan.",
  category: "Panduan",
  date: "4 April 2026",
  isoDate: "2026-04-04",
  readTime: "5 menit",
  image: "/images/blog/panduan-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Website sudah tayang, tampilannya rapi, semua tombol berfungsi. Wajar kalau Anda merasa pekerjaan sudah tuntas. Beberapa bulan kemudian, formulir kontak diam-diam berhenti mengirim pesan, atau muncul peringatan tidak aman di browser pengunjung. Perawatan website justru dibuat untuk mencegah kejadian semacam ini. Artikel ini merinci apa saja isinya dan mengapa tidak layak dilewatkan.' },
  { type: 'h2', text: 'Website Bukan Barang Sekali Jadi' },
  { type: 'p', text: 'Berbeda dari brosur cetak yang isinya membeku selamanya, website hidup di lingkungan yang terus berubah. Browser diperbarui, standar keamanan naik, mesin pencari mengubah cara menilai halaman, dan komponen di balik layar merilis versi baru. Website yang tidak bergerak sama sekali lama-lama tertinggal oleh lingkungannya sendiri.' },
  { type: 'p', text: 'Analogi yang paling dekat adalah kendaraan. Bisa saja Anda memakainya terus tanpa ganti oli, dan untuk sementara terasa baik-baik saja. Masalah baru muncul belakangan, dan biaya memperbaikinya jauh lebih besar daripada merawatnya sejak awal.' },
  { type: 'h2', text: 'Pekerjaan yang Dilakukan dalam Perawatan' },
  { type: 'p', text: 'Isi perawatan bisa berbeda tergantung jenis website, tapi umumnya mencakup:' },
  { type: 'ul', items: [
    'Pencadangan berkala beserta uji coba pemulihan, karena cadangan yang tidak pernah diuji belum tentu bisa dipakai.',
    'Pemasangan pembaruan keamanan pada komponen yang dipakai website.',
    'Perpanjangan dan pemantauan sertifikat keamanan agar alamat tetap berawalan https.',
    'Pemeriksaan formulir, tombol, dan tautan agar tidak ada yang diam-diam rusak.',
    'Pemantauan kecepatan muat halaman, terutama pada perangkat seluler.',
    'Pengawasan agar website tetap dapat diakses dan segera ketahuan bila tiba-tiba mati.',
    'Pembersihan berkas menumpuk dan data lama yang membebani penyimpanan.',
    'Penyegaran informasi yang kedaluwarsa seperti harga lama, jam operasional, atau kontak.',
  ] },
  { type: 'h2', text: 'Risiko Nyata Bila Diabaikan' },
  { type: 'p', text: 'Yang paling merugikan biasanya bukan website mati total, melainkan kerusakan senyap. Formulir kontak yang berhenti berfungsi tidak menampilkan pesan error apa pun kepada Anda. Dari luar semuanya tampak normal, sementara calon pelanggan mengira pesannya terkirim padahal tidak pernah sampai.' },
  { type: 'p', text: 'Contoh serupa mudah ditemui: tombol pesan yang mengarah ke nomor lama, halaman produk yang hilang gambarnya setelah pembaruan, atau pembayaran yang gagal diproses karena sambungan ke layanan pihak ketiga kedaluwarsa. Semuanya berlangsung tanpa pemberitahuan, dan sering baru ketahuan setelah ada pelanggan yang kebetulan mengeluh.' },
  { type: 'p', text: 'Risiko lain datang dari sisi keamanan. Celah pada komponen yang tidak diperbarui bisa dimanfaatkan untuk menyisipkan halaman asing di website Anda. Selain merusak reputasi, kondisi ini dapat membuat website ditandai bermasalah oleh browser atau mesin pencari, dan memulihkan kepercayaan itu perlu waktu.' },
  { type: 'h2', text: 'Seberapa Sering Perlu Dilakukan?' },
  { type: 'p', text: 'Tidak semua tugas berjalan dengan irama yang sama. Pencadangan dan pemantauan akses sebaiknya berlangsung otomatis dan terus-menerus. Pembaruan keamanan mengikuti kapan versi barunya dirilis. Sementara pemeriksaan menyeluruh terhadap tautan, kecepatan, dan isi konten cukup dijadwalkan secara rutin dalam periode tertentu.' },
  { type: 'p', text: 'Kuncinya adalah punya jadwal, bukan menunggu ada yang mengeluh. Perawatan yang berjalan diam-diam memang tidak terlihat hasilnya — dan justru itulah tandanya bekerja.' },
  { type: 'p', text: 'Kalau saat ini Anda belum punya rutinitas apa pun, mulailah dari dua hal paling mendasar: pastikan pencadangan berjalan otomatis dan cobalah kirim pesan lewat formulir kontak Anda sendiri bulan ini. Dua langkah sederhana itu sudah menutup sebagian besar risiko yang paling sering terjadi.' },
];

export default content;

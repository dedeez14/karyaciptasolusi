import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-ssl-https",
  title: "Apa Itu SSL/HTTPS dan Kenapa Website Anda Wajib Memilikinya",
  excerpt: "Kenali arti gembok kecil di sebelah alamat website, kenapa browser menandai situs tanpa HTTPS sebagai tidak aman, dan cara memastikan website Anda terlindungi.",
  category: "Keamanan",
  date: "31 Juli 2026",
  isoDate: "2026-07-31",
  readTime: "5 menit",
  image: "/images/blog/keamanan-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Anda mungkin pernah melihat tulisan "Tidak aman" muncul di sebelah alamat sebuah website saat membukanya. Peringatan itu bukan karena browser terlalu cerewet, melainkan karena website tersebut belum memakai HTTPS. Artikel ini menjelaskan apa itu SSL dan HTTPS dengan bahasa sederhana, kenapa website bisnis wajib memilikinya, dan bagaimana memastikan milik Anda sudah aman.' },
  { type: 'h2', text: 'SSL dan HTTPS Sebenarnya Apa' },
  { type: 'p', text: 'Bayangkan data yang dikirim dari browser pengunjung ke server website Anda seperti surat yang melewati banyak tangan. Tanpa pengaman, surat itu berupa kartu pos yang bisa dibaca siapa saja di sepanjang jalur. SSL, dan penerusnya yang bernama TLS, adalah amplop tersegel untuk surat tersebut. Ketika sebuah website memakai SSL, alamatnya berubah dari HTTP menjadi HTTPS dan browser menampilkan ikon gembok. Huruf S di belakang HTTP berarti secure: isi komunikasi diacak sehingga hanya browser dan server yang bisa membacanya.' },
  { type: 'h2', text: 'Kenapa Ini Penting untuk Website Bisnis' },
  { type: 'ul', items: [
    'Kepercayaan pengunjung: peringatan tidak aman membuat calon pelanggan menutup halaman sebelum sempat membaca penawaran Anda.',
    'Perlindungan data: formulir kontak, halaman login admin, dan proses pembayaran mengirim informasi yang sebaiknya tidak terbaca pihak lain.',
    'Mesin pencari: Google sejak lama menjadikan HTTPS sebagai salah satu sinyal kualitas sebuah website.',
    'Syarat teknis: banyak layanan modern, termasuk sebagian besar penyedia pembayaran, hanya mau berjalan di atas koneksi HTTPS.',
    'Citra profesional: alamat berawalan HTTPS terlihat wajar saat dibagikan di media sosial, chat, atau kartu nama.',
  ] },
  { type: 'h2', text: 'Cara Memeriksa Website Anda Sendiri' },
  { type: 'p', text: 'Pemeriksaannya tidak membutuhkan keahlian teknis sama sekali. Buka website Anda di browser, lalu perhatikan tiga hal berikut.' },
  { type: 'ul', items: [
    'Apakah alamatnya diawali https:// dan bukan http:// saja?',
    'Apakah ada ikon gembok atau tanda serupa di sebelah kiri kolom alamat?',
    'Klik ikon tersebut untuk melihat informasi sertifikat, termasuk sampai kapan masa berlakunya.',
  ] },
  { type: 'p', text: 'Sertifikat SSL punya tanggal kedaluwarsa dan harus diperpanjang. Banyak penyedia hosting kini menyediakan sertifikat gratis yang diperbarui otomatis, tetapi tetap ada gunanya menandai tanggal tersebut di kalender Anda. Sertifikat yang telat diperpanjang membuat browser menampilkan halaman peringatan besar yang menakuti pengunjung, padahal website Anda sendiri baik-baik saja.' },
  { type: 'h2', text: 'Masalah yang Sering Muncul Setelah SSL Terpasang' },
  { type: 'p', text: 'Kadang gembok tidak juga muncul meski sertifikat sudah aktif. Penyebab paling umum adalah mixed content, yaitu sebagian isi halaman seperti gambar atau file lama masih dipanggil lewat alamat http://. Solusinya adalah memperbarui alamat-alamat tersebut agar ikut memakai https://. Masalah lain yang sering terjadi adalah website tetap bisa dibuka lewat kedua alamat sekaligus. Idealnya, semua kunjungan http:// dialihkan otomatis ke https:// supaya pengunjung selalu berada di jalur yang aman tanpa perlu berpikir.' },
  { type: 'h2', text: 'HTTPS Bukan Jaminan Segalanya' },
  { type: 'p', text: 'Satu hal yang perlu diluruskan: gembok hijau berarti komunikasi Anda terenkripsi, bukan berarti pemilik website itu jujur. Situs penipuan pun bisa memasang SSL. Jadi tetap perhatikan nama domainnya, bukan hanya ada tidaknya gembok. Sebaliknya, website bisnis yang sah tanpa HTTPS justru akan tampak mencurigakan di mata pengunjung, meski niatnya baik.' },
  { type: 'p', text: 'HTTPS adalah fondasi keamanan paling dasar, bukan fitur tambahan yang bisa ditunda. Kalau Anda ragu apakah sertifikat website sudah terpasang dengan benar atau masih ada halaman yang bermasalah, tim PT Karya Cipta Solusi terbuka untuk membantu memeriksanya lewat konsultasi gratis.' },
];

export default content;

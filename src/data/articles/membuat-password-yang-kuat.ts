import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "membuat-password-yang-kuat",
  title: "Password Kuat: Aturan Sederhana yang Sering Diabaikan",
  excerpt: "Panjang lebih penting daripada simbol rumit. Pahami cara membuat password yang kuat sekaligus mudah diingat, dan kebiasaan kecil yang menjaganya tetap aman.",
  category: "Keamanan",
  date: "15 Juli 2026",
  isoDate: "2026-07-15",
  readTime: "5 menit",
  image: "/images/blog/keamanan-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Hampir semua orang tahu password sebaiknya kuat. Masalahnya, banyak yang mengartikan kuat sebagai rumit dan sulit diingat, lalu menyerah dan memakai satu password yang sama di mana-mana. Padahal aturan password yang baik jauh lebih sederhana daripada yang dibayangkan. Artikel ini merangkum prinsip yang benar-benar berpengaruh, tanpa membuat Anda pusing setiap kali login.' },
  { type: 'h2', text: 'Panjang Mengalahkan Kerumitan' },
  { type: 'p', text: 'Password yang panjang jauh lebih sulit ditebak dibanding password pendek yang penuh simbol. Alasannya sederhana: setiap karakter tambahan melipatgandakan jumlah kemungkinan kombinasi. Kata sandi delapan karakter dengan tanda seru dan angka di ujungnya terlihat rumit bagi manusia, tetapi tetap tergolong pendek. Karena itu, target pertama Anda bukan simbol, melainkan panjang. Dua belas karakter adalah titik awal yang wajar, dan lebih panjang selalu lebih baik.' },
  { type: 'h2', text: 'Resep Praktis: Rangkaian Kata yang Tidak Berhubungan' },
  { type: 'p', text: 'Cara termudah membuat password panjang yang tetap mudah diingat adalah menggabungkan tiga sampai empat kata yang tidak saling berkaitan menjadi satu frasa, lalu memberi sedikit variasi huruf besar atau angka. Gabungan kata seperti payung, kompor, dan sepeda jauh lebih panjang sekaligus lebih mudah diingat dibanding deretan karakter acak yang akhirnya Anda tulis di kertas. Yang perlu dihindari adalah frasa yang bisa ditebak dari profil Anda: nama anak, tanggal lahir, nama bisnis, plat nomor, atau nomor telepon.' },
  { type: 'h2', text: 'Kebiasaan yang Melemahkan Password Sekuat Apa Pun' },
  { type: 'ul', items: [
    'Memakai satu password untuk banyak akun. Bila satu layanan bermasalah, akun Anda yang lain ikut terancam.',
    'Membagikan password lewat chat atau email, lalu membiarkan pesannya tersimpan bertahun-tahun.',
    'Menyimpan daftar password di catatan tempel pada monitor atau di file bernama password.docx.',
    'Memakai pola beruntun, misalnya hanya mengganti angka bulan di akhir setiap kali diminta memperbarui.',
    'Login akun bisnis di komputer bersama atau perangkat pinjaman tanpa logout setelah selesai.',
  ] },
  { type: 'h2', text: 'Password Manager Membuat Semuanya Realistis' },
  { type: 'p', text: 'Manusia memang tidak dirancang untuk mengingat puluhan password unik. Di sinilah password manager berguna. Aplikasi ini menyimpan seluruh password Anda dalam brankas terenkripsi, dan Anda hanya perlu mengingat satu password utama untuk membukanya. Ia juga bisa membuatkan password acak yang panjang setiap kali Anda mendaftar layanan baru. Pilih aplikasi dengan reputasi yang jelas, aktifkan perlindungan tambahan pada akun brankasnya, dan simpan cara pemulihannya di tempat aman. Bagi tim kecil, fitur berbagi akses di dalam brankas jauh lebih rapi daripada mengirim password lewat grup chat.' },
  { type: 'h2', text: 'Dahulukan Akun yang Paling Berharga' },
  { type: 'p', text: 'Kalau membenahi semua akun sekaligus terasa berat, mulailah dari yang paling berdampak: email utama, akun domain dan hosting, admin website, akun media sosial bisnis, serta layanan keuangan. Email utama layak mendapat perhatian pertama karena hampir semua akun lain memakainya sebagai jalur pemulihan password. Perlakukan email seperti kunci brankas, bukan sekadar kotak surat.' },
  { type: 'h2', text: 'Kapan Password Perlu Diganti' },
  { type: 'p', text: 'Mengganti password secara rutin tanpa alasan justru sering membuat orang memilih pola yang mudah ditebak. Yang lebih penting adalah mengganti segera ketika ada alasan nyata: Anda mendapat notifikasi login yang tidak dikenal, sebuah layanan mengumumkan datanya bermasalah, seorang karyawan berhenti, atau Anda sempat memasukkan password di halaman yang belakangan terasa mencurigakan.' },
  { type: 'p', text: 'Anda tidak perlu membereskan semuanya hari ini. Ganti password email utama menjadi frasa panjang yang unik, lalu lanjutkan satu akun per hari sampai selesai. Perubahan kecil yang dijalankan konsisten jauh lebih bertahan daripada pembenahan besar yang hanya dilakukan sekali lalu dilupakan.' },
];

export default content;

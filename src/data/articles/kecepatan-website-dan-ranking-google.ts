import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "kecepatan-website-dan-ranking-google",
  title: "Kenapa Kecepatan Website Menentukan Ranking di Google",
  excerpt: "Kecepatan memengaruhi kenyamanan pengunjung sekaligus penilaian Google. Kenali penyebab website lambat dan perbaikan yang dampaknya paling terasa.",
  category: "SEO",
  date: "5 Juni 2026",
  isoDate: "2026-06-05",
  readTime: "5 menit",
  image: "/images/blog/seo-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Anda mungkin pernah mengalaminya sendiri: mengklik sebuah tautan dari HP, layar putih beberapa detik, lalu Anda menutupnya dan kembali ke hasil pencarian. Pengunjung website Anda melakukan hal yang sama. Kecepatan bukan sekadar urusan kenyamanan — ia memengaruhi berapa banyak orang yang bertahan cukup lama untuk membaca penawaran Anda, dan ikut diperhitungkan Google saat menilai halaman.' },
  { type: 'h2', text: 'Kenapa Google Peduli pada Kecepatan' },
  { type: 'p', text: 'Google menilai pengalaman pemakaian halaman, bukan hanya isinya. Ada sekelompok ukuran yang sering disebut Core Web Vitals, dan intinya menilai tiga hal yang mudah dibayangkan: seberapa cepat bagian utama halaman tampil, seberapa cepat halaman merespons saat disentuh, dan seberapa stabil tata letaknya — apakah tombol tiba-tiba bergeser saat halaman masih dimuat.' },
  { type: 'p', text: 'Perlu jujur soal bobotnya. Kecepatan bukan faktor ajaib yang mengalahkan relevansi. Halaman yang agak lambat tetapi paling menjawab pertanyaan pencari tetap bisa unggul. Namun ketika beberapa halaman sama-sama relevan, pengalaman yang lebih baik menjadi pembeda — dan bagi pengunjung, bedanya terasa langsung.' },
  { type: 'h2', text: 'Penyebab Paling Umum Website Lambat' },
  { type: 'p', text: 'Dari kasus yang sering ditemui, penyebabnya jarang rumit. Biasanya berkisar pada hal-hal berikut.' },
  { type: 'ul', items: [
    'Gambar berukuran sangat besar yang diunggah apa adanya langsung dari kamera atau HP.',
    'Terlalu banyak plugin atau skrip pihak ketiga, termasuk yang sudah lama tidak dipakai.',
    'Hosting dengan sumber daya terbatas, atau server yang lokasinya jauh dari mayoritas pengunjung.',
    'Tema dan template berat yang penuh animasi, padahal fiturnya tidak semuanya digunakan.',
    'Tidak ada caching, sehingga halaman dibangun ulang dari nol setiap kali ada yang membuka.',
  ] },
  { type: 'h2', text: 'Cara Mengecek Tanpa Perlu Jadi Teknis' },
  { type: 'p', text: 'Google menyediakan PageSpeed Insights secara gratis. Anda cukup memasukkan alamat halaman, lalu membaca ringkasannya. Jangan terpaku pada skor angkanya — bagian yang lebih berguna adalah daftar saran perbaikan di bawahnya, karena di situ terlihat mana yang benar-benar memberatkan halaman Anda. Google Search Console juga punya laporan pengalaman halaman yang berbasis kunjungan nyata.' },
  { type: 'p', text: 'Satu kebiasaan yang layak diubah: berhentilah menilai kecepatan website dari laptop kantor dengan WiFi kencang. Ujilah memakai HP kelas menengah dengan koneksi seluler biasa, karena itulah kondisi sebagian besar pengunjung Anda.' },
  { type: 'h2', text: 'Perbaikan yang Dampaknya Paling Terasa' },
  { type: 'ul', items: [
    'Kompres gambar dan gunakan format modern, lalu tampilkan pada ukuran seperlunya saja.',
    'Muat gambar yang berada di bawah layar hanya ketika pengunjung menggulir ke sana.',
    'Singkirkan plugin dan skrip yang tidak lagi dipakai, termasuk pelacak lama.',
    'Aktifkan caching, dan pertimbangkan CDN bila pengunjung Anda tersebar di banyak wilayah.',
    'Pilih hosting yang sepadan dengan beban trafik, bukan sekadar yang termurah.',
  ] },
  { type: 'p', text: 'Yang menarik, hampir semua perbaikan di atas berguna bahkan seandainya Google tidak pernah menghitung kecepatan sama sekali — halaman yang ringan membuat lebih banyak orang bertahan dan menghubungi Anda. Bila Anda tidak yakin bagian mana yang paling memberatkan website Anda, PT Karya Cipta Solusi bisa membantu menelusurinya lewat konsultasi gratis sebelum Anda memutuskan perlu perbaikan sebesar apa.' },
];

export default content;

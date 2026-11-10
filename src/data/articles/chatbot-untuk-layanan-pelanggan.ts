import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "chatbot-untuk-layanan-pelanggan",
  title: "Chatbot untuk Layanan Pelanggan: Kapan Berguna, Kapan Tidak",
  excerpt: "Chatbot bisa meringankan beban admin, tapi juga bisa mengusir pelanggan. Kenali situasi yang cocok, yang tidak cocok, dan aturan main agar tidak salah pakai.",
  category: "Teknologi",
  date: "27 Juni 2026",
  isoDate: "2026-06-27",
  readTime: "5 menit",
  image: "/images/blog/teknologi-3.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Pukul sebelas malam pesan masuk masih berdatangan. Isinya sering itu-itu saja: stok masih ada tidak, ongkos kirim ke daerah tertentu berapa, jam buka sampai kapan. Wajar kalau muncul pikiran untuk memasang chatbot supaya pertanyaan seperti itu terjawab otomatis. Tapi sebelum memasangnya, ada baiknya memahami di mana chatbot benar-benar menolong dan di mana ia justru membuat pelanggan kabur.' },
  { type: 'h2', text: 'Chatbot Itu Resepsionis, Bukan Ahli Teknis' },
  { type: 'p', text: 'Bayangkan meja resepsionis di sebuah kantor. Tugasnya menyambut tamu, menjawab pertanyaan umum, dan mengarahkan orang ke bagian yang tepat. Tidak ada yang berharap resepsionis menyelesaikan sengketa kontrak atau memperbaiki mesin. Chatbot bekerja persis di posisi itu. Ia unggul pada volume dan kecepatan untuk hal-hal yang sudah terpola, dan lemah pada situasi yang butuh pertimbangan, empati, atau kewenangan.' },
  { type: 'h2', text: 'Situasi di Mana Chatbot Benar-Benar Membantu' },
  { type: 'ul', items: [
    'Pertanyaan yang berulang setiap hari dan jawabannya tetap: jam operasional, lokasi, cara pemesanan, metode pembayaran.',
    'Jam di luar waktu kerja, ketika alternatifnya adalah pesan tidak dibalas sama sekali sampai besok pagi.',
    'Mengarahkan pengunjung ke halaman atau kategori yang tepat ketika mereka tidak tahu harus mulai dari mana.',
    'Mengumpulkan informasi awal — nama, jenis kebutuhan, nomor pesanan — sebelum percakapan diteruskan ke staf.',
    'Memeriksa status pesanan atau pengiriman secara otomatis jika datanya memang tersedia di sistem.',
  ] },
  { type: 'p', text: 'Benang merahnya: chatbot bagus untuk pekerjaan yang jawabannya sudah Anda ketahui dan tinggal disampaikan berulang kali.' },
  { type: 'h2', text: 'Situasi di Mana Chatbot Justru Merugikan' },
  { type: 'ul', items: [
    'Komplain, terutama dari pelanggan yang sudah kecewa. Balasan otomatis pada saat seperti ini terasa seperti diabaikan.',
    'Kasus dengan pengecualian, misalnya permintaan retur di luar ketentuan atau pesanan khusus.',
    'Negosiasi harga, penawaran proyek, atau apa pun yang butuh kewenangan memutuskan.',
    'Informasi yang berubah cepat, seperti stok terbatas, jika chatbot tidak terhubung ke data yang sebenarnya.',
    'Percakapan yang sudah berputar-putar. Pelanggan yang harus mengulang pertanyaan tiga kali biasanya tidak akan kembali.',
  ] },
  { type: 'h2', text: 'Aturan Main agar Chatbot Tidak Mengusir Pelanggan' },
  { type: 'p', text: 'Kebanyakan pengalaman buruk dengan chatbot bukan disebabkan teknologinya, melainkan cara pemasangannya. Beberapa prinsip berikut menekan risiko itu:' },
  { type: 'ul', items: [
    'Sediakan jalan keluar ke manusia yang jelas dan mudah, sejak pesan pertama. Jangan sembunyikan.',
    'Jujur sejak awal bahwa pengguna sedang berbicara dengan sistem otomatis, lengkap dengan perkiraan jam respons staf.',
    'Jawab singkat dan langsung. Paragraf panjang di layar HP jarang dibaca sampai habis.',
    'Jangan meminta informasi yang sudah pernah diberikan pelanggan di percakapan yang sama.',
    'Kumpulkan pertanyaan yang gagal dijawab, lalu perbaiki secara berkala. Daftar itu adalah bahan perbaikan paling berharga.',
  ] },
  { type: 'h2', text: 'Mulai dari Daftar Pertanyaan, Bukan dari Teknologi' },
  { type: 'p', text: 'Langkah pertama yang paling murah bukan memilih platform, melainkan membuka riwayat percakapan tiga bulan terakhir dan mendaftar pertanyaan yang paling sering muncul. Kalau ternyata sebagian besar pesan bisa dijawab dengan sepuluh jawaban baku, chatbot sederhana sudah cukup memberi dampak. Kalau ternyata tiap pelanggan datang dengan kebutuhan berbeda, memperbaiki halaman informasi di website mungkin lebih berguna daripada memasang bot.' },
  { type: 'p', text: 'Kalau Anda ragu di posisi mana bisnis Anda berada, silakan manfaatkan sesi konsultasi gratis di PT Karya Cipta Solusi untuk memetakan alur layanan pelanggan Anda terlebih dahulu.' },
];

export default content;

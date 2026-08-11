import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "uu-pdp-dan-website-bisnis",
  title: "UU Perlindungan Data Pribadi: Apa Artinya bagi Website Bisnis Anda",
  excerpt: "Aturan perlindungan data pribadi berlaku juga untuk website bisnis kecil. Pahami prinsip dasarnya dan langkah awal yang masuk akal untuk mulai menyesuaikan diri.",
  category: "Keamanan",
  date: "9 Maret 2026",
  isoDate: "2026-03-09",
  readTime: "6 menit",
  image: "/images/blog/keamanan-2.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Sejak Indonesia memiliki Undang-Undang Perlindungan Data Pribadi atau UU PDP, pertanyaan yang sering muncul dari pemilik usaha adalah: apakah aturan sebesar itu juga berlaku untuk website kecil saya? Jawaban amannya, bila website Anda mengumpulkan data pribadi orang, prinsip-prinsipnya relevan bagi Anda. Tulisan ini menjelaskan prinsip umumnya dengan bahasa sehari-hari sebagai bahan awal, bukan sebagai nasihat hukum, agar Anda tahu apa yang perlu dibicarakan dengan penasihat hukum Anda.' },
  { type: 'h2', text: 'Data Pribadi Lebih Luas dari Dugaan Banyak Orang' },
  { type: 'p', text: 'Data pribadi bukan hanya nomor identitas. Nama, nomor telepon, alamat email, alamat rumah, foto, sampai informasi yang bila digabungkan bisa menunjuk pada satu orang tertentu, semuanya termasuk. Sebagian jenis data diperlakukan lebih hati-hati lagi, misalnya yang berkaitan dengan kesehatan, keuangan, atau data biometrik. Website bisnis biasanya mengumpulkannya lewat formulir kontak, pendaftaran newsletter, keranjang belanja, hingga fitur chat. Langkah pertama yang berguna adalah menyadari bahwa Anda sudah menyimpan lebih banyak data daripada yang Anda kira.' },
  { type: 'h2', text: 'Prinsip yang Menjadi Inti Aturan' },
  { type: 'ul', items: [
    'Persetujuan: data dikumpulkan dengan sepengetahuan dan persetujuan pemiliknya, bukan diam-diam.',
    'Tujuan yang jelas: data dipakai untuk keperluan yang Anda sampaikan saat mengumpulkannya, bukan untuk hal lain yang tidak pernah disebutkan.',
    'Seperlunya saja: kumpulkan sebatas yang benar-benar dibutuhkan untuk tujuan tersebut.',
    'Keamanan: pihak yang memegang data bertanggung jawab menjaganya dengan langkah pengamanan yang wajar.',
    'Akurasi dan masa simpan: data dijaga tetap benar dan tidak disimpan selamanya tanpa alasan.',
    'Akuntabilitas: Anda perlu mampu menjelaskan data apa yang dipegang dan bagaimana pengelolaannya.',
  ] },
  { type: 'h2', text: 'Hak Orang yang Datanya Anda Simpan' },
  { type: 'p', text: 'Sisi lain dari aturan ini adalah hak pemilik data. Secara umum, seseorang berhak mengetahui data apa yang Anda pegang dan untuk apa, meminta salinannya, meminta koreksi bila ada yang keliru, meminta penghapusan dalam batas tertentu, serta menarik persetujuan yang pernah diberikan. Konsekuensi praktisnya sederhana: bisnis perlu menyediakan jalur yang mudah bagi pelanggan untuk menyampaikan permintaan seperti itu. Satu alamat email khusus yang benar-benar dipantau sudah jauh lebih baik daripada tidak ada sama sekali.' },
  { type: 'h2', text: 'Langkah Awal yang Masuk Akal untuk Bisnis Kecil' },
  { type: 'ul', items: [
    'Buat daftar sederhana: data apa yang Anda kumpulkan, lewat kanal apa, tersimpan di mana, dan siapa saja yang bisa mengaksesnya.',
    'Tulis kebijakan privasi dengan bahasa yang mudah dipahami, lalu tautkan di bagian bawah website dan di dekat setiap formulir.',
    'Minta persetujuan secara jujur. Hindari kotak centang yang sudah tercentang lebih dulu untuk keperluan pemasaran.',
    'Kurangi kolom formulir yang sebenarnya tidak Anda butuhkan.',
    'Periksa layanan pihak ketiga yang Anda pakai, karena data pelanggan sering ikut mengalir ke sana.',
    'Siapkan rencana bila terjadi insiden: siapa yang dihubungi, apa yang dicatat, dan bagaimana memberi tahu pihak yang terdampak.',
  ] },
  { type: 'h2', text: 'Kapan Sebaiknya Bertanya kepada Ahlinya' },
  { type: 'p', text: 'Artikel ini sengaja berhenti di tataran prinsip. Ketentuan teknis, kewajiban khusus untuk jenis data atau jenis usaha tertentu, batas waktu pelaporan, serta konsekuensi bila kewajiban tidak dipenuhi sebaiknya Anda tanyakan kepada penasihat hukum yang memahami perlindungan data. Konsultasi seperti ini semakin penting bila bisnis Anda memproses data dalam jumlah besar, menangani data yang bersifat sensitif, bekerja sama dengan banyak pihak ketiga, atau melayani pelanggan lintas negara.' },
  { type: 'p', text: 'Kabar baiknya, hampir semua prinsip di atas sejalan dengan praktik bisnis yang sehat: kumpulkan seperlunya, jelaskan apa adanya, jaga dengan sungguh-sungguh. Mulailah dari mendata apa yang Anda pegang saat ini, lalu bawa hasilnya ke penasihat hukum Anda untuk memastikan penerapannya sudah tepat.' },
];

export default content;

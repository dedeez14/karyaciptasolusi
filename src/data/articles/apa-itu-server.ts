import type { BlogBlock } from '../blogTypes';

export const meta = {
  slug: "apa-itu-server",
  title: "Apa Itu Server? Rumah bagi Website dan Aplikasi Anda",
  excerpt: "Shared hosting, VPS, uptime, bandwidth — istilah yang membingungkan saat membaca penawaran. Pahami semuanya lewat analogi tempat tinggal yang mudah dicerna.",
  category: "Teknologi",
  date: "23 Maret 2026",
  isoDate: "2026-03-23",
  readTime: "5 menit",
  image: "/images/blog/teknologi-1.svg",
};

const content: BlogBlock[] = [
  { type: 'p', text: 'Saat menerima penawaran pembuatan website, biasanya ada baris biaya bernama hosting atau server, lengkap dengan istilah seperti VPS, uptime, dan bandwidth. Bagian ini paling sering dilewati begitu saja karena terdengar teknis. Sayangnya, di situlah letak banyak keputusan yang memengaruhi kecepatan dan keandalan website Anda. Mari kita bongkar dengan analogi yang mudah.' },
  { type: 'h2', text: 'Server Adalah Komputer yang Tidak Pernah Tidur' },
  { type: 'p', text: 'Server pada dasarnya adalah komputer, hanya saja dirancang untuk menyala terus-menerus dan melayani permintaan dari banyak orang sekaligus. Ia disimpan di gedung khusus dengan listrik cadangan, pendingin, dan pengamanan ketat.' },
  { type: 'p', text: 'Alurnya sederhana. Ketika seseorang mengetik alamat website Anda, perangkatnya mengirim permintaan ke server tempat website itu disimpan. Server menyiapkan halaman yang diminta lalu mengirimkannya kembali. Seluruh proses itu terjadi dalam hitungan detik, dan kualitas server menentukan seberapa cepat serta seberapa jarang proses ini gagal.' },
  { type: 'h2', text: 'Empat Jenis Hosting dalam Analogi Tempat Tinggal' },
  { type: 'ul', items: [
    'Shared hosting seperti kos-kosan: banyak penghuni berbagi satu bangunan dan fasilitasnya. Murah, cukup untuk kebutuhan ringan, tapi kalau satu penghuni memakai air berlebihan, yang lain ikut terganggu.',
    'VPS seperti rumah petak dengan meteran sendiri: masih satu bangunan, tapi jatah listrik dan air Anda terpisah sehingga tidak mudah terpengaruh tetangga.',
    'Dedicated server seperti rumah sendiri: seluruh bangunan milik Anda, bebas diatur, tapi seluruh biaya dan perawatan juga tanggungan Anda.',
    'Cloud server seperti ruang yang bisa ditambah atau dikurangi sesuai kebutuhan: fleksibel saat lonjakan pengunjung, dengan biaya mengikuti pemakaian.',
  ] },
  { type: 'p', text: 'Untuk website company profile atau toko online yang baru mulai, pilihan paling ringan biasanya sudah memadai. Naik kelas sebaiknya dilakukan saat kebutuhannya nyata, bukan sejak awal karena khawatir.' },
  { type: 'h2', text: 'Istilah yang Sering Muncul di Lembar Penawaran' },
  { type: 'ul', items: [
    'Uptime: seberapa besar waktu server dijanjikan menyala dan bisa diakses. Semakin tinggi semakin baik.',
    'Bandwidth: jumlah data yang boleh dikirim ke pengunjung dalam periode tertentu, mirip kuota internet.',
    'Storage: ruang penyimpanan untuk file website, gambar, dan basis data.',
    'RAM dan CPU: tenaga untuk memproses permintaan. Penting bila website Anda punya banyak fitur dinamis.',
    'SSL: sertifikat yang membuat alamat website berawalan https dan mengamankan data yang dikirim pengunjung.',
    'Backup: pencadangan otomatis, yang menentukan seberapa cepat Anda bisa pulih bila terjadi masalah.',
  ] },
  { type: 'h2', text: 'Tanda Bahwa Anda Perlu Naik Kelas' },
  { type: 'ul', items: [
    'Website terasa lambat justru pada jam ramai atau saat kampanye promosi berjalan.',
    'Halaman sesekali gagal terbuka dan menampilkan pesan kesalahan, terutama saat trafik naik.',
    'Anda butuh memasang perangkat lunak khusus yang tidak diizinkan di paket bersama.',
    'Data dan file terus bertambah hingga mendekati batas penyimpanan.',
  ] },
  { type: 'h2', text: 'Lokasi Server Ternyata Berpengaruh' },
  { type: 'p', text: 'Data tetap butuh waktu untuk menempuh jarak. Jika seluruh pelanggan Anda berada di Indonesia sementara servernya berada di benua lain, ada jeda tambahan pada setiap permintaan. Jeda itu kecil, tapi terasa ketika halaman perlu memuat banyak elemen. Memilih lokasi server yang dekat dengan mayoritas pengunjung adalah cara sederhana meningkatkan kecepatan tanpa mengubah apa pun pada website.' },
  { type: 'p', text: 'Kalau Anda sedang membandingkan penawaran hosting dan bingung mana yang sepadan dengan kebutuhan bisnis Anda, PT Karya Cipta Solusi terbuka untuk konsultasi gratis membantu Anda menimbangnya tanpa keharusan memakai jasa kami.' },
];

export default content;

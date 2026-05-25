import { useState, useRef } from 'react';
import { useReactToPrint } from 'react-to-print';

function formatRupiah(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export default function SuratKontrakGenerator() {
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const [noKontrak, setNoKontrak] = useState('PKS/KCS/2026/001');
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [pihak1Nama, setPihak1Nama] = useState('PT Karya Cipta Solusi');
  const [pihak1Alamat, setPihak1Alamat] = useState('Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru, Tapos, Depok 16455');
  const [pihak1Jabatan, setPihak1Jabatan] = useState('Direktur');
  const [pihak2Nama, setPihak2Nama] = useState('');
const [pihak2Alamat, setPihak2Alamat] = useState('');
  const [pihak2Jabatan, setPihak2Jabatan] = useState('Direktur');
  const [judul, setJudul] = useState('');
  const [ruangLingkup, setRuangLingkup] = useState('');
  const [jangkaWaktu, setJangkaWaktu] = useState('');
  const [nilaiKontrak, setNilaiKontrak] = useState(0);
  const [pembayaran, setPembayaran] = useState('30% di awal (DP), 40% saat demo, 30% setelah selesai');

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <h3 className="font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Data Perjanjian</h3>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">No. Kontrak</label>
            <input value={noKontrak} onChange={e => setNoKontrak(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
          <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
        </div>

        <div className="p-4 rounded-xl border border-[#F0E6D3] bg-[#FFFBF3]">
          <p className="text-xs font-bold text-[#D4941A] mb-3">PIHAK PERTAMA</p>
          <div className="space-y-2">
            <div><label className="text-xs text-[#6B6B7B] mb-1 block">Nama</label>
              <input value={pihak1Nama} onChange={e => setPihak1Nama(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
            <div><label className="text-xs text-[#6B6B7B] mb-1 block">Jabatan</label>
              <input value={pihak1Jabatan} onChange={e => setPihak1Jabatan(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
            <div><label className="text-xs text-[#6B6B7B] mb-1 block">Alamat</label>
              <textarea value={pihak1Alamat} onChange={e => setPihak1Alamat(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#F0E6D3] bg-white">
          <p className="text-xs font-bold text-[#0F4C81] mb-3">PIHAK KEDUA</p>
          <div className="space-y-2">
            <div><label className="text-xs text-[#6B6B7B] mb-1 block">Nama Perusahaan</label>
              <input value={pihak2Nama} onChange={e => setPihak2Nama(e.target.value)} placeholder="Nama perusahaan klien" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
            <div><label className="text-xs text-[#6B6B7B] mb-1 block">Jabatan Penandatangan</label>
              <input value={pihak2Jabatan} onChange={e => setPihak2Jabatan(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
            <div><label className="text-xs text-[#6B6B7B] mb-1 block">Alamat</label>
              <textarea value={pihak2Alamat} onChange={e => setPihak2Alamat(e.target.value)} rows={2} placeholder="Alamat lengkap pihak kedua" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
          </div>
        </div>

        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Judul Pekerjaan</label>
          <input value={judul} onChange={e => setJudul(e.target.value)} placeholder="Contoh: Pengembangan Aplikasi ERP" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Ruang Lingkup Pekerjaan</label>
          <textarea value={ruangLingkup} onChange={e => setRuangLingkup(e.target.value)} rows={3} placeholder="Deskripsikan ruang lingkup pekerjaan" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Jangka Waktu</label>
          <input value={jangkaWaktu} onChange={e => setJangkaWaktu(e.target.value)} placeholder="Contoh: 3 (tiga) bulan" className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Nilai Kontrak (Rp)</label>
          <input type="number" value={nilaiKontrak} onChange={e => setNilaiKontrak(Number(e.target.value))} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>
        <div><label className="text-xs font-semibold text-[#6B6B7B] mb-1 block">Ketentuan Pembayaran</label>
          <textarea value={pembayaran} onChange={e => setPembayaran(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-[#F0E6D3] text-sm focus:outline-none focus:border-[#F4B942]" /></div>

        <button onClick={() => handlePrint()} className="w-full py-3 bg-[#F4B942] text-white font-bold rounded-xl hover:bg-[#D4941A] transition-colors">
          Print / Download PDF
        </button>
      </div>

      {/* PREVIEW */}
      <div>
        <h3 className="font-bold text-[#2D2D3A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Preview</h3>
        <div ref={printRef} className="bg-white p-10 rounded-xl border border-[#F0E6D3] shadow-sm" style={{ fontFamily: "'Inter', sans-serif", fontSize: '11px', lineHeight: '1.6' }}>
          <div className="text-center mb-6">
            <h2 className="text-lg font-bold text-[#2D2D3A]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>PERJANJIAN KERJASAMA</h2>
            <p className="text-[10px] text-[#6B6B7B] mt-1">No: {noKontrak}</p>
          </div>

          <p className="mb-4 text-[#2D2D3A]">Pada hari ini, {tanggal ? new Date(tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '........................'}, yang bertanda tangan di bawah ini:</p>

          <div className="mb-4 pl-4">
            <p className="font-bold text-[#2D2D3A] mb-1">PIHAK PERTAMA:</p>
            <p className="text-[#2D2D3A]">Nama &nbsp;&nbsp;: <span className="font-bold">{pihak1Nama}</span></p>
            <p className="text-[#2D2D3A]">Jabatan : {pihak1Jabatan}</p>
            <p className="text-[#2D2D3A]">Alamat &nbsp;: {pihak1Alamat}</p>
            <p className="text-[#6B6B7B] italic mt-1">Selanjutnya disebut <strong>PIHAK PERTAMA</strong></p>
          </div>

          <div className="mb-4 pl-4">
            <p className="font-bold text-[#2D2D3A] mb-1">PIHAK KEDUA:</p>
            <p className="text-[#2D2D3A]">Nama &nbsp;&nbsp;: <span className="font-bold">{pihak2Nama || '........................'}</span></p>
            <p className="text-[#2D2D3A]">Jabatan : {pihak2Jabatan}</p>
            <p className="text-[#2D2D3A]">Alamat &nbsp;: {pihak2Alamat || '........................'}</p>
            <p className="text-[#6B6B7B] italic mt-1">Selanjutnya disebut <strong>PIHAK KEDUA</strong></p>
          </div>

          <p className="mb-4 text-[#2D2D3A]">PIHAK PERTAMA dan PIHAK KEDUA secara bersama-sama disebut <strong>Para Pihak</strong>, telah sepakat untuk mengadakan perjanjian kerjasama dengan ketentuan sebagai berikut:</p>

          <div className="mb-4">
            <p className="font-bold text-[#2D2D3A] mb-2">PASAL 1 - JUDUL PEKERJAAN</p>
            <p className="text-[#2D2D3A] pl-4">Para Pihak sepakat untuk melaksanakan pekerjaan: <strong>{judul || '........................'}</strong></p>
          </div>

          <div className="mb-4">
            <p className="font-bold text-[#2D2D3A] mb-2">PASAL 2 - RUANG LINGKUP</p>
            <p className="text-[#2D2D3A] pl-4">{ruangLingkup || 'Ruang lingkup pekerjaan akan dijelaskan dalam dokumen terpisah (SRS/BRD) yang merupakan bagian tidak terpisahkan dari perjanjian ini.'}</p>
          </div>

          <div className="mb-4">
            <p className="font-bold text-[#2D2D3A] mb-2">PASAL 3 - JANGKA WAKTU</p>
            <p className="text-[#2D2D3A] pl-4">Pekerjaan ini akan dilaksanakan selama <strong>{jangkaWaktu || '........................'}</strong> terhitung sejak penandatanganan perjanjian ini.</p>
          </div>

          <div className="mb-4">
            <p className="font-bold text-[#2D2D3A] mb-2">PASAL 4 - NILAI KONTRAK</p>
            <p className="text-[#2D2D3A] pl-4">Nilai kontrak pekerjaan ini sebesar <strong>{formatRupiah(nilaiKontrak)}</strong> ({nilaiKontrak > 0 ? 'terbilang' : '........................'}).</p>
          </div>

          <div className="mb-4">
            <p className="font-bold text-[#2D2D3A] mb-2">PASAL 5 - CARA PEMBAYARAN</p>
            <p className="text-[#2D2D3A] pl-4">{pembayaran}</p>
          </div>

          <div className="mb-8">
            <p className="font-bold text-[#2D2D3A] mb-2">PASAL 6 - PENUTUP</p>
            <p className="text-[#2D2D3A] pl-4">Perjanjian ini dibuat dan ditandatangani oleh Para Pihak dalam rangkap 2 (dua) yang sama bunyinya dan mempunyai kekuatan hukum yang sama, pada tanggal tersebut di atas.</p>
          </div>

          <div className="grid grid-cols-2 gap-8 mt-8">
            <div className="text-center">
              <p className="font-bold text-[#2D2D3A] mb-1">PIHAK PERTAMA</p>
              <p className="text-[10px] text-[#6B6B7B] mb-8">{pihak1Nama}</p>
              <p className="font-bold text-[#2D2D3A] text-sm">( ........................ )</p>
              <p className="text-[10px] text-[#6B6B7B]">{pihak1Jabatan}</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-[#2D2D3A] mb-1">PIHAK KEDUA</p>
              <p className="text-[10px] text-[#6B6B7B] mb-8">{pihak2Nama || '........................'}</p>
              <p className="font-bold text-[#2D2D3A] text-sm">( ........................ )</p>
              <p className="text-[10px] text-[#6B6B7B]">{pihak2Jabatan}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

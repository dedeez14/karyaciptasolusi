import { useState, useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

interface InvoiceItem {
  id: number;
  deskripsi: string;
  qty: number;
  satuan: string;
  harga: number;
}

function formatRupiah(n: number) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

function terbilang(n: number): string {
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  if (n < 12) return satuan[n];
  if (n < 20) return satuan[n - 10] + ' belas';
  if (n < 100) return satuan[Math.floor(n / 10)] + ' puluh ' + satuan[n % 10];
  if (n < 200) return 'seratus ' + terbilang(n - 100);
  if (n < 1000) return satuan[Math.floor(n / 100)] + ' ratus ' + terbilang(n % 100);
  if (n < 2000) return 'seribu ' + terbilang(n - 1000);
  if (n < 1000000) return terbilang(Math.floor(n / 1000)) + ' ribu ' + terbilang(n % 1000);
  if (n < 1000000000) return terbilang(Math.floor(n / 1000000)) + ' juta ' + terbilang(n % 1000000);
  return terbilang(Math.floor(n / 1000000000)) + ' miliar ' + terbilang(n % 1000000000);
}

export default function InvoiceGenerator() {
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const [noInvoice, setNoInvoice] = useState('INV/KCS/2026/001');
  const [tanggal, setTanggal] = useState(new Date().toISOString().split('T')[0]);
  const [jatuhTempo, setJatuhTempo] = useState('');
  const [kepada, setKepada] = useState('');
  const [alamatKlien, setAlamatKlien] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([
    { id: 1, deskripsi: '', qty: 1, satuan: 'unit', harga: 0 },
  ]);
  const [catatan, setCatatan] = useState('Pembayaran via transfer ke rekening PT Karya Cipta Solusi');

  const addItem = () => setItems([...items, { id: Date.now(), deskripsi: '', qty: 1, satuan: 'unit', harga: 0 }]);
  const removeItem = (id: number) => setItems(items.filter(i => i.id !== id));
  const updateItem = (id: number, field: keyof InvoiceItem, value: string | number) => {
    setItems(items.map(i => i.id === id ? { ...i, [field]: value } : i));
  };

  const subtotal = items.reduce((sum, i) => sum + i.qty * i.harga, 0);
  const ppn = subtotal * 0.11;
  const total = subtotal + ppn;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* FORM */}
      <div className="space-y-4">
        <h3 className="font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Data Invoice</h3>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-[#475569] mb-1 block">No. Invoice</label>
            <input value={noInvoice} onChange={e => setNoInvoice(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
          <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Tanggal</label>
            <input type="date" value={tanggal} onChange={e => setTanggal(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>
        </div>

        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Jatuh Tempo</label>
          <input type="date" value={jatuhTempo} onChange={e => setJatuhTempo(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>

        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Kepada Yth.</label>
          <input value={kepada} onChange={e => setKepada(e.target.value)} placeholder="Nama klien/perusahaan" className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>

        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Alamat Klien</label>
          <textarea value={alamatKlien} onChange={e => setAlamatKlien(e.target.value)} rows={2} placeholder="Alamat lengkap klien" className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-[#475569]">Item / Jasa</label>
            <button onClick={addItem} className="flex items-center gap-1 text-xs font-semibold text-[#1D4ED8] hover:text-[#2563EB]"><Plus size={14} /> Tambah</button>
          </div>
          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-12 gap-2 mb-2 items-end">
              <div className="col-span-5"><input value={item.deskripsi} onChange={e => updateItem(item.id, 'deskripsi', e.target.value)} placeholder="Deskripsi" className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-2"><input type="number" value={item.qty} onChange={e => updateItem(item.id, 'qty', Number(e.target.value))} className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs text-center focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-1"><input value={item.satuan} onChange={e => updateItem(item.id, 'satuan', e.target.value)} className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs text-center focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-3"><input type="number" value={item.harga} onChange={e => updateItem(item.id, 'harga', Number(e.target.value))} placeholder="Harga" className="w-full px-2 py-1.5 rounded border border-[#E2E8F0] text-xs focus:outline-none focus:border-[#2563EB]" /></div>
              <div className="col-span-1">{items.length > 1 && <button onClick={() => removeItem(item.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>}</div>
            </div>
          ))}
        </div>

        <div><label className="text-xs font-semibold text-[#475569] mb-1 block">Catatan</label>
          <textarea value={catatan} onChange={e => setCatatan(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-sm focus:outline-none focus:border-[#2563EB]" /></div>

        <button onClick={() => handlePrint()} className="w-full py-3 bg-[#2563EB] text-white font-bold rounded-xl hover:bg-[#1D4ED8] transition-colors">
          Print / Download PDF
        </button>
      </div>

      {/* PREVIEW */}
      <div>
        <h3 className="font-bold text-[#0F172A] mb-3" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Preview</h3>
        <div ref={printRef} className="bg-white p-8 rounded-xl border border-[#E2E8F0] shadow-sm" style={{ fontFamily: "'Inter', sans-serif" }}>
          {/* Invoice Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <img src="/images/logo-main.png" alt="" className="w-10 h-10 object-contain" />
                <div><p className="font-bold text-[#0F172A] text-sm">PT Karya Cipta Solusi</p><p className="text-[10px] text-[#1D4ED8] font-bold tracking-wider">SOLUSI TEKNOLOGI</p></div>
              </div>
              <p className="text-[10px] text-[#475569] mt-1">Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru</p>
              <p className="text-[10px] text-[#475569]">Tapos, Depok 16455 | 0838-9891-1244</p>
            </div>
            <div className="text-right">
              <h2 className="text-2xl font-bold" style={{ color: '#1D4ED8', fontFamily: "'Space Grotesk', sans-serif" }}>INVOICE</h2>
              <p className="text-xs text-[#475569] mt-1">{noInvoice}</p>
            </div>
          </div>

          {/* Info */}
          <div className="grid grid-cols-2 gap-4 mb-6 bg-[#F8FAFC] p-4 rounded-lg">
            <div>
              <p className="text-[10px] text-[#475569] font-semibold uppercase">Kepada</p>
              <p className="text-sm font-bold text-[#0F172A]">{kepada || '(Nama Klien)'}</p>
              <p className="text-[10px] text-[#475569]">{alamatKlien || '(Alamat)'}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#475569]"><span className="font-semibold">Tanggal:</span> {tanggal ? new Date(tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-'}</p>
              {jatuhTempo && <p className="text-[10px] text-[#475569]"><span className="font-semibold">Jatuh Tempo:</span> {new Date(jatuhTempo).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>}
            </div>
          </div>

          {/* Items Table */}
          <table className="w-full mb-6">
            <thead><tr className="border-b-2 border-[#2563EB]">
              <th className="text-left text-[10px] font-bold text-[#475569] uppercase py-2 w-8">No</th>
              <th className="text-left text-[10px] font-bold text-[#475569] uppercase py-2">Deskripsi</th>
              <th className="text-center text-[10px] font-bold text-[#475569] uppercase py-2 w-12">Qty</th>
              <th className="text-right text-[10px] font-bold text-[#475569] uppercase py-2 w-24">Harga</th>
              <th className="text-right text-[10px] font-bold text-[#475569] uppercase py-2 w-28">Total</th>
            </tr></thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} className="border-b border-[#E2E8F0]">
                  <td className="py-2 text-xs text-[#475569]">{idx + 1}</td>
                  <td className="py-2 text-xs text-[#0F172A] font-medium">{item.deskripsi || '-'}</td>
                  <td className="py-2 text-xs text-center text-[#475569]">{item.qty} {item.satuan}</td>
                  <td className="py-2 text-xs text-right text-[#475569]">{formatRupiah(item.harga)}</td>
                  <td className="py-2 text-xs text-right font-semibold text-[#0F172A]">{formatRupiah(item.qty * item.harga)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end mb-6">
            <div className="w-64">
              <div className="flex justify-between py-1"><span className="text-xs text-[#475569]">Subtotal</span><span className="text-xs font-semibold text-[#0F172A]">{formatRupiah(subtotal)}</span></div>
              <div className="flex justify-between py-1"><span className="text-xs text-[#475569]">PPN 11%</span><span className="text-xs font-semibold text-[#0F172A]">{formatRupiah(ppn)}</span></div>
              <div className="flex justify-between py-2 border-t-2 border-[#2563EB] mt-1">
                <span className="text-sm font-bold text-[#0F172A]">TOTAL</span>
                <span className="text-sm font-bold" style={{ color: '#1D4ED8' }}>{formatRupiah(total)}</span>
              </div>
              <p className="text-[10px] text-[#475569] italic mt-1">{total > 0 ? terbilang(Math.floor(total)) + ' rupiah' : ''}</p>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-[#E2E8F0] pt-4">
            <p className="text-[10px] text-[#475569] mb-4">{catatan}</p>
            <div className="grid grid-cols-2 gap-8">
              <div className="text-center">
                <p className="text-[10px] text-[#475569] mb-8">Hormat Kami,</p>
                <p className="text-xs font-bold text-[#0F172A]">PT Karya Cipta Solusi</p>
                <div className="w-24 h-[1px] bg-[#0F172A] mx-auto mb-1"></div>
                <p className="text-[10px] text-[#475569]">Direktur</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-[#475569] mb-8">Mengetahui,</p>
                <p className="text-xs font-bold text-[#0F172A]">{kepada || '........................'}</p>
                <div className="w-24 h-[1px] bg-[#0F172A] mx-auto mb-1"></div>
                <p className="text-[10px] text-[#475569]">Klien</p>
              </div>
            </div>
          </div>

          <div className="text-center mt-6 pt-4 border-t border-[#E2E8F0]">
            <p className="text-[9px] text-[#475569]">PT Karya Cipta Solusi | Kp. Sindangkarsa, RT.05/RW.15, Sukamaju Baru, Tapos, Depok 16455 | Telp: 0838-9891-1244</p>
          </div>
        </div>
      </div>
    </div>
  );
}

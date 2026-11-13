# Industry blueprint: making the ERP fit every business line

Research done on 12 Nov 2026, before building, so the work is done once. Items marked **[unverified]** must be checked against the official text before they are encoded.

The goal is to avoid building one separate app per industry. Most lines share the same **engines**; each line then adds a thin layer (its own masters, screens and rules) on top.

---

## 1. Shared engines (build once, used by many lines)

| Engine | Used by |
|---|---|
| **Realtime bus** (WebSocket gateway; rooms per outlet and device role) | POS customer display, kitchen display (KDS), queue / order-ready board, shop-floor kiosk, andon |
| **Multi-level BOM + formula mode + co/by-products** | every factory, bakery and restaurant recipes, palm oil mill (FFB → CPO + kernel + shell), slaughterhouse |
| **Routing, work centres and operations** (hourly rates, normal capacity, calendar) | all factories; workshop (bengkel); garment lines |
| **Production / cycle cost accumulation with WIP and variances** | factories, livestock cycles, plantation TBM, construction projects |
| **Quality** (inspection plan, results per lot, hold/release, NCR/CAPA, CoA) | factories, food, pharmacy, agri grading |
| **Recurring billing and instalment schedules** | rental, subscriptions, schools, property instalments and leases, retainers |
| **Progress / milestone billing with retention** | construction, property, project services |
| **Tax-code engine extensions**: PPN *besaran tertentu* with non-creditable input VAT; PPh 4(2) variants; PPh 22; date-bounded incentives (PPN DTP) | agri, logistics, construction, property, import |
| **Price lists, promotions and credit limits** | retail, distribution, POS |
| **Resource calendar** (rooms, equipment, chairs, staff) | salon, workshop, rental, hotel, clinic |
| **Licence / certificate register with expiry alerts** | halal, BPOM, SNI, SBU/SKK, KIR, HGU/IUP, NKV, ISPO, STR/SIP |
| **Service ticket with status** | workshop, laundry, repair, helpdesk |
| **Field daily-record PWA** (offline, GPS, photo) | livestock, plantation, route sales, site logs |

---

## 2. Point of Sale: complete for every outlet type

**Already built (commit 3508bb1):**
- cashier shifts with cash count and over/short posting;
- touch/scan cashier screen;
- split payments (cash, QRIS, card, transfer);
- 58/80 mm receipt; void; daily recap;
- retail PKP mode (faktur digunggung) and food & beverage mode (PBJT).

### Segments and their flows
- **Minimarket / retail.** Flow: scan → weighed fresh items (GS1 prefix 20–29) → promotion → member → pay → receipt → end-of-day recap. Also: cash pickup during the shift, shelf-label printing.
- **Fashion.** Variant matrix (size × colour) with a barcode per variant, exchanges against the receipt, transfers between stores.
- **Full-service restaurant.** Flow: floor plan → table → covers → order by course with modifiers → send to KDS/printer → fire the next course → bill → split/merge → service charge → PBJT → pay.
- **Quick service / café.** Order (counter, kiosk or QR) → pay first → queue number → KDS → "ready" board with a chime → pick-up.
- **Food court.** A central cashier routes each line to the tenant's KDS, and tenants are settled minus commission.
- **Bakery.** Display stock made by production batch (BOM backflush), sold by weight or piece, closing markdown, pre-orders with a deposit.
- **Pharmacy.**
  - Drug class: OTC, limited OTC, prescription-only, psychotropic, narcotic.
  - Prescription record; dispensing by FEFO.
  - Monthly SIPNAP report for narcotics and psychotropics: Permenkes 5/2023.
  - Prescriptions kept 5 years, with a destruction record: Permenkes 73/2016 **[secondary source]**.
- **Salon / barber / spa.** Appointments by staff and chair, packages, commissions passed to payroll (PPh 21).
- **Workshop (bengkel).** Vehicle intake → estimate → approval → job (labour + parts) → QC → invoice → service reminder.
- **Laundry.** Weigh or count → tag → status → notification → pick-up.
- **Hotel F&B outlet.** Post to room (folio), breakfast covers, banquets.

### Shared infrastructure
- **One realtime channel per outlet.** Events: `cart.updated`, `payment.qris_shown`, `payment.settled`, `order.fired`, `item.bumped`, `order.ready`, `order.collected`. The customer display, KDS, expo screen and queue board all subscribe to it. A second screen on the same PC uses `BroadcastChannel`.
- **Customer display:**
  - cart lines, discount, tax and service;
  - total, dynamic QRIS, change due;
  - member points;
  - promotional slides when idle.
- **KDS:**
  - routing per station (kitchen, bar, grill) plus expo;
  - ticket states: new → in progress → bumped / recalled; courses held → fired;
  - colour timers, modifiers and allergens highlighted, all-day counts, printer fallback.
- **Queue board:** "Preparing" and "Ready" columns, chime / text-to-speech, auto-clear after pick-up.
- **Hardware:** ESC/POS over WebUSB/WebSerial, cash-drawer kick (ESC p), serial scale, label printer.
- **Offline:** PWA with an IndexedDB queue, receipt numbers per device, replay with server-side idempotency.

### Rules to respect
- **Faktur digunggung** (PER-11/PJ/2025 Art. 51–55):
  - final consumers only;
  - minimum content: seller name, NPWP / TKU address, goods, price incl. PPN, PPN;
  - motor vehicles are **excluded** (Art. 55);
  - the monthly recap goes into the SPT Masa PPN;
  - transactions with PPN facilities must not be put in the same recap.
- **PPN rate:** 12% on a base of 11/12, which is 11% effective (PMK 131/2024).
- **PBJT** (UU 1/2022 Art. 58):
  - food & drink, hotel, parking and entertainment: max 10%;
  - discos, karaoke, nightclubs and bars: 40–75% (upheld by MK 32/PUU-XXII/2024);
  - spa is no longer entertainment (MK 19/PUU-XXII/2024);
  - the rate and the turnover threshold come from the local Perda (Jakarta: Rp42m/month);
  - the base is **after discount and including service charge** (Jakarta, Pergub 35/2024);
  - many regions require a **tapping box** / e-reporting, so per-transaction export is needed.
- **Service charge** (Permenaker 7/2016, for hotels and restaurants in hotels):
  - split 95% to workers, 3% for loss/damage risk, 2% for staff development;
  - totals announced every month;
  - non-wage income, subject to PPh 21.
- **QRIS MDR** (from 1 Oct 2026, BI):
  - micro merchants: 0% up to Rp500k, 0.3% above;
  - other merchants: 0% up to Rp100k, 0.7% above;
  - the fee is borne by the merchant and **must not be charged to the customer**.
- **Cash must be accepted:** UU 7/2011 Art. 23 and 33. A "cashless only" outlet must still allow cash.
- **Prices** (Permendag 35/2013): shown in Rupiah; if the shelf and checkout prices differ, **the lower price applies**.
- **Scales** must be verified and re-verified: UU 2/1981 (legal metrology).
- **Halal** (UU 33/2014, PP 42/2024):
  - medium and large F&B businesses: mandatory since 17 Oct 2024;
  - micro and small businesses: Oct 2026, with a reported delay to 2028 **[unverified]**;
  - non-halal items must be labelled.
- **UU PDP** for member data: consent, purpose, export/deletion, breach handling.

---

## 3. Manufacturing: every factory type

### How each industry runs
- **Car / motorcycle (discrete assembly).**
  - Plan: MPS by model and variant → MRP over a multi-level BOM (phantom items, super-BOM with configurator).
  - Supply: kanban / JIT, sequenced to the line.
  - Build: body → paint → trim / final assembly at takt, with quality gates per station and rework.
  - Identity: VIN/NIK with frame and engine numbers, SRUT per unit.
  - Change control: ECO with effectivity.
- **Corrugated carton (make-to-order).**
  - Estimate: FEFCO style, flute, board grade (GSM), blank size, cost per 1,000 boxes.
  - Corrugator combination / trim planner → converting (printer-slotter, die-cut, glue/stitch).
  - Dies and plates are tooling; trim is sold as by-product scrap.
- **Paint / chemicals (batch process).**
  - Formula in % → scaled batch → weighing / dispensing per lot → grind, let-down.
  - QC lab (viscosity, colour ΔE, density) → tint / adjust → retest → CoA → pack (bulk + can BOM).
  - SDS/GHS data; B3 waste.
- **Food & beverage:** recipe batch, HACCP/CCP, lot and expiry, allergens, halal per ingredient and supplier, BPOM MD/ML number per SKU.
- **Garment:** size/colour matrix, cut plan and bundle tickets, operation bulletin (SAM), line efficiency, CMT subcontracting (maklon).
- **Plastics / injection moulding:** moulds with cavity count, cycle time and shot counter; resin + masterbatch %; regrind loop.
- **Furniture:** multi-level BOM, cut list / nesting, finishing routing, configurator.
- **Printing:** estimate from paper, imposition, colours and makeready (shares the carton estimator design).

### Manufacturing core (all factories)
1. Multi-level BOM:
   - versions, phantom items, scrap % per line, alternates;
   - formula mode (%, batch size, scaling, yield);
   - co- and by-products;
   - cost roll-up through the levels.
2. Work centres and routing:
   - setup and run time;
   - labour and machine rates per hour;
   - overhead absorbed per operation;
   - normal capacity.
3. Production order reporting per operation:
   - good / scrap / rework quantities, partial receipts, backflush;
   - scrap split into normal and abnormal;
   - by-product received at NRV;
   - WIP, and variance close (price, usage, efficiency, volume).
4. Quality: incoming / in-process / final inspection, AQL, results per lot, hold/release, NCR/CAPA, CoA.
5. MPS/MRP and capacity: make-to-order pegging, work-centre load, dispatch list.
6. Subcontracting (maklon): stock held at the vendor, service PO, PPh 23.
7. Shop-floor kiosk: scan order and operation, operator, quantities, downtime.
8. Maintenance and OEE: equipment and tooling register, preventive maintenance by calendar / hours / shots, breakdown orders.
9. ECO with approval and effectivity.
10. Serial genealogy in both directions (extends the existing lot recall trace).

### Industry add-ons
- **Automotive:** configurator, VIN check digit and WMI, frame/engine register, SRUT, line sequencing, kanban, PPnBM table on the invoice.
- **Carton / printing:** estimator, trim planner, tooling.
- **Paint / food:** weighing terminal, tinting loop, SDS, catch weight, allergens.
- **Garment:** matrix, cut plan, bundles, SAM.
- **Moulding / furniture:** cavities, regrind, nesting.
- **Bonded zone (KB) / KITE:** BC documents and IT Inventory mutation reports.

### Rules to respect
- **Licensing:** PP 28/2025 replaced PP 5/2021 (risk-based licensing). Keep the NIB and the KBLI per product line.
- **SIINas:** Permenperin 13/2025 makes reporting **quarterly**, due by the 10th of April, July, October and January. New fields include capacity per quarter, material origin, and machine data (operators, capacity/hour, fuel/hour).
- **TKDN:** Permenperin 35/2025, in force 11 Dec 2025.
  - Verified against the official text (Art. 4-12, Annex I-II): material 75%, labour 10%, overhead 15%.
  - Material factor = sum of each component's cost share x credited domestic share. Certified components count 100 / 80 / 60 / 40 / 25% by TKDN band; uncertified components count 100% (domestic, all-domestic materials), 25% (made by a domestic industry) or 0% (imported).
  - Labour and overhead count 100 / 60 / 30% by production setup; labour counts 0% when under 50% of workers are Indonesian.
  - Brainware adds up to 20%; the total is capped at 100%.
  - Annex I form 1.4 prints 3.36% x 75% as 2.25% (should be 2.52%).
  - Supply chain traced to tier 2; certificate valid 5 years.
  - EV (KBLBB): 40% until 2026, then 60% for 2027–2029 (Perpres 79/2023).
- **Mandatory SNI:**
  - tyres: Permenperin 9/2025 jo 24/2026;
  - colour-coated steel: Permenperin 24/2025;
  - bottled drinking water (AMDK): from Oct 2026;
  - paint lead limit SNI 8011:2024 is **voluntary [unverified]**.
- **Automotive:**
  - NIK/VIN: Permenperin 34/2017, 34/2019, 23/2021;
  - type testing: PM 33/2018 jo PM 30/2020 / 23/2021;
  - PPnBM: PP 74/2021, PMK 141/2021 jo 42/2022.
- **Halal / BPOM:** PP 42/2024; Peraturan BPOM 27/2017 jo 7/2021 (registration) and 31/2018 jo 6/2024 (labelling).
- **B3 waste:** PP 22/2021 and Permen LHK 6/2021, verified against the official text.
  - Storage limits (Art. 79): 90 days at 50 kg/day or more, 180 days for category 1, 365 days for category 2.
  - Festronik manifest for transport (Art. 99).
  - Logbook and waste balance (neraca) in the Annex IX formats, reported at least every 6 months at plb3.menlhk.go.id (Art. 80).
- **K3:** SMK3 under PP 50/2012 for firms with 100+ workers or high hazard.
- **Customs:** Kawasan Berikat PMK 131/2018; KITE PMK 160/2018 jo 149/2022.
- **Accounting:** SAK EP Ch. 13 / PSAK 202.
  - Fixed overhead allocated on **normal capacity**; under-absorption is expensed.
  - **Abnormal waste is expensed.**
  - By-products at NRV deducted from the main product's cost.
  - Standard cost allowed if it approximates actual cost.

---

## 4. Agribusiness: livestock and plantations

### Livestock
- **Broiler / layer poultry.**
  - Flow: house → DOC placement → daily records (feed, water, medicine/vaccines, dead and culled birds, temperature) → weight sampling → vaccinations → catch / harvest (DO, count, kg) → close the cycle.
  - Layers: daily egg grades, culling (afkir).
  - KPIs:
    - deplesi %; FCR = feed kg / live weight kg;
    - IP = (livability % × ABW kg) / (FCR × age) × 100;
    - HDP %; cost per kg.
- **Inti-plasma partnership** (Permentan 13/2017, checked against the official text).
  - Written agreement with the items of Art. 11 (2), acknowledged by the regency / city (Art. 11 (3)).
  - Partnership report at least every 3 months (Art. 19, Format-2).
  - The core company supplies DOC, feed and medicine at contract prices and buys the harvest.
  - RHPP settlement = harvest × contract price − inputs + FCR/IP bonus − penalties.
  - Plasma sub-ledger.
- **Cattle:**
  - ear tag, weighings, ADG, rations, treatments;
  - breeding: heat, AI/service, pregnancy check, calving, S/C ratio.
- **Dairy:** milk per cow per milking, lactation, fat/SNF/TPC (drives the price paid).
- **Aquaculture:** pond → stocking → feeding (feed trays) → water quality (DO, pH, salinity) → sampling → partial / final harvest. KPIs: SR, FCR, ADG, tonnes per ha.

### Plantations (oil palm and others)
- **Hierarchy:** Estate → Division (afdeling) → Block: planting year, ha, SPH, variety, phase (nursery / TBM / TM), GPS polygon.
- **Flow:**
  1. Nursery → planting → TBM upkeep (30–36 months) → TM.
  2. Harvest round every 7–10 days: harvester → TPH → mandor grading and penalties.
  3. SPB (transport note) → mill weighbridge (gross / tare / net, sorting deduction).
  4. Mill: CPO, kernel, shell, EFB (OER / KER).
- **BKM / checkroll:**
  - daily work per worker, block and activity: HK or output;
  - piece rate = base task + premium − penalties;
  - feeds payroll.
- **Other crops:**
  - rubber (latex, dry rubber content KKK);
  - sugar cane (rendemen);
  - coffee / cocoa (conversion ratios);
  - horticulture (crop cycle per plot).

### Accounting
- **Full PSAK:** PSAK 241 (formerly 69, agriculture) at fair value less costs to sell; bearer plants under PSAK 216 (formerly 16).
- **SAK EP, Section 34** (from IFRS for SMEs **[SAK EP text to be checked]**):
  - fair value if readily determinable, otherwise cost;
  - produce at harvest at fair value less costs to sell under both models.
- **Practical policy:** always accumulate actual cost per cycle or block (tax, partnership settlement, management). Set the FV or cost model per class, with an optional FV revaluation journal.
- **Broiler journals:**
  - DOC, feed and medicine: Dr Biological asset – flock / Cr Inventory;
  - abnormal mortality: to loss;
  - harvest: to inventory at FV − costs to sell.
- **Oil palm journals:**
  - nursery → TBM per block → reclassify to TM → depreciate. Permentan 131/2013 Lampiran is inconsistent: TBM 36–48 months in the definitions, but the harvest chapter says after about 30 months or when more than 60% of the palms carry ripe bunches of about 4 kg (guidance; configurable);
  - tax (PMK 72/2023, read): perkebunan tanaman keras = group 4, 20 years straight line from the first month of sales (Art. 12–15); labour is **not** part of the fiscal cost (Art. 14 (2));
  - TM upkeep is expensed in accounting, but DJP may capitalise it for tax. **Conflict to flag.**

### Tax and permits
- **PPN on agricultural produce** (PMK 64/2022 jo PMK 11/2025; PMK 64/2022 text and annex read, PMK 11/2025 via the DJP press release):
  - 1.1% of the price (10% x 11/12 x 12%) *besaran tertentu*, at the PKP's option (Art. 2), notified to the KPP (Art. 4); after switching back to the normal method the PKP can never return (Art. 5 (6));
  - TBS is listed in Lampiran A (I. Perkebunan, kelapa sawit); faktur code 05; input VAT **not creditable** (Art. 7);
  - an industrial buyer (mill) buying from such a PKP collects the PPN (Art. 8) **[whether PMK 11/2025 changed Art. 8 unverified]**; a non-PKP charges nothing.
- **PP 49/2022:** VAT exemption on livestock, feed and seeds. Input VAT is not creditable.
- **PPh 22 on purchases of produce** (PMK 51/2025, official text read): 0.25% of the price excl. PPN by industrial buyers and exporters (Art. 2 (1) g, 3 (1) f), due at purchase (Art. 5 (7)); purchases up to Rp20 million excl. PPN in one tax month are exempt (Art. 4 (1) e angka 6). No PP 55 certificate exemption for this category (only for government purchases).
- **PBB P5L** (PMK 186/2019 jo 234/2022): per block category; planting-year map.
- **Plantations:**
  - UU 39/2014 jo UU 6/2023; HGU;
  - 20% plasma (Art. 58; PP 26/2021, Permentan 18/2021);
  - ISPO: Perpres 16/2025 replaced Perpres 44/2020; technical rules Permentan 33/2025.
- **EUDR** (Reg. 2023/1115 as amended by Reg. 2025/2650, read): from 30 Dec 2026 for large / medium operators, 30 Jun 2027 for micro / small. Geolocation (Art. 2 (28)): a point with at least 6 decimals; a polygon for plots above 4 ha.
- **TBS purchase from partner smallholders:** Permentan 13/2024 replaced Permentan 01/2018: HTBS = K x (HCPO x RCPO + HPK x RPK) + shell value; K set monthly by the provincial Kepala Dinas. Grading deductions (Lampiran II): unripe 50%, overripe 25% of the share above 5%, empty 100%, long stalk 1%, loose fruit short of 10%: 30% of the shortfall, dirty loose fruit 2x, bunches under 3 kg 70%. Mill acceptance (Art. 21): 0% unripe, at least 95% ripe, stalk at most 2.5 cm, at least 3 kg per bunch.
- **Ripeness fractions** (Permentan 131/2013 Tabel 23 from PPKS): 00 / 0 unripe, 1 under-ripe, 2–3 ripe, 4–5 overripe. No SNI for TBS found.
- **Livestock:**
  - UU 18/2009 jo 41/2014;
  - NKV (Permentan 11/2020);
  - SKKH / SV animal movement (Permentan 17/2023, iSIKHNAS);
  - halal slaughter (PP 42/2024).
- **Labour:**
  - daily wage = monthly / 25 (6-day week) or / 21 (5-day week) (PP 36/2021 Art. 17); piece rates agreed (Art. 18) but pay must not fall below the minimum wage (Art. 23 (3)) [secondary transcription];
  - daily workers working 21+ days a month for 3 months become permanent (PP 35/2021 Art. 10);
  - UU 27/2026 replaced UU 13/2003, but its piece-rate and daily-worker rules are **[unverified]**, so keep them configurable.

---

## 5. Other business lines

| Line | Main flow | Key rules | New vs reuse |
|---|---|---|---|
| Professional services / software house | proposal → engagement → timesheets → WIP → invoice (milestone / T&M / retainer) | PPh 23 2% (licences possibly 15% royalty **[unverified]**) | smallest: timesheets, rate cards, WIP |
| Distribution / FMCG | route plan → visit / order / van sale → credit check → delivery → collection → principal claims | PPN 12% (DPP 11/12); consignment **[unverified]** | price lists and schemes, credit limits, route PWA, claims |
| Import / export | PO → LC/TT → PIB (CEISA) → duties, PPN import, PPh 22 import → landed cost | PPh 22 import 2.5% / 7.5%; NIB as API-U / API-P; DHE SDA (PP 8/2025) | customs register, landed cost, LC |
| Construction | BoQ/RAB → budget (RAP) → site requests → progress certificate → termin − retention − DP recovery → PHO / FHO | PPh final 4(2) PP 9/2022 (1.75 / 2.65 / 4 / 3.5 / 6%); SBU/SKK (UU 2/2017) | BoQ, budget control, termin, subcon claims |
| Property developer | units and site plan → booking (NUP) → PPJB → instalments / KPR tranches → AJB → handover; leases | PPh final 2.5% / 1% (PP 34/2016); rent 10% (PP 34/2017); PPN DTP 2026 (PMK 90/2025); BPHTB max 5%; PPJB (PP 12/2021) | units, instalments, leases |
| Logistics / forwarding | quote → job → legs → dispatch → trip sheet → POD → invoice → vendor costs | PPN 1.1% *besaran tertentu* (PMK 71/2022 jo 11/2025); PPh 23 2%; PM 60/2019, KIR | jobs, fleet, trips, POD, job costing |
| Rental / subscription | contract → delivery → meter → periodic invoice → return / inspection | PPh 23 2% on equipment rent | recurring billing, availability calendar |
| Education | admission → enrolment → fee plan → invoices / VA → arrears | PPN-exempt (PP 49/2022) | recurring billing skin |
| Cooperative | member savings, SHU, savings and loans | SAK EP from 2025 (Permenkop UKM 2/2024); annual report by 30 Apr | chart template, member ledger, SHU |
| Hotel | rates → reservation / OTA → check-in → folio → housekeeping → night audit | PBJT max 10% (Perda) | full PMS: large |
| Clinic | registration (NIK, BPJS) → queue → SOAP / ICD-10 → pharmacy → billing → SATUSEHAT | RME (Permenkes 24/2022); P-Care; health data is a specific category under UU PDP | largest: EMR plus integrations |

---

## 6. Proposed build order

1. **POS outlet suite.** The owner asked for this explicitly.
   - Realtime bus.
   - Customer display.
   - Modifiers, combos, recipe backflush.
   - KDS with expo and the queue board.
   - Tables, open bills, split/merge, courses.
   - Service charge and PBJT engine (base after discount incl. service, threshold, tapping export).
   - Promotions, members, outlet price lists.
2. **Manufacturing core.**
   - Multi-level BOM, formula and co/by-products.
   - Work centres and routing.
   - Operation reporting, WIP and variances, under SAK EP Ch. 13.
   - Quality, MRP, subcontracting, shop-floor kiosk, maintenance/OEE.
   - Compliance pack: quarterly SIINas, TKDN, certificate registers, B3.
3. **Agribusiness.**
   - Location and cycle master, daily records and KPIs.
   - BKM / checkroll. **Built:** blocks (GeoJSON boundary, EUDR flag), BKM with piece rates / premiums / grading penalties, payroll checkroll line, materials, TBM capitalisation -> bearer-plant asset, SPB + weighbridge with the Permentan 13/2024 grading deduction, production & cost and checkroll reports.
   - Harvest → weighbridge.
   - Biological-asset accounting, agri tax, inti-plasma, mill.
4. **Industry add-ons:** automotive (VIN, PPnBM), carton estimator, paint lab / tinting, garment matrix, bonded zone.
5. **Service and trading lines, by value per new code:** professional services → recurring billing → distribution → landed cost → construction → property → logistics → cooperative → hotel → clinic.

Each phase starts by re-checking the **[unverified]** items it depends on.

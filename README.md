<p align="center">
  <img src="./public/icon.png" alt="JadiPRD logo" width="96" height="96" />
</p>

<h1 align="center">JadiPRD</h1>

<p align="center">
  <strong>Dari ide jadi PRD.</strong><br />
  Ubah obrolan singkat menjadi PRD dan UI Prompt yang rapi, ringkas, dan siap dieksekusi.
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-111111?style=for-the-badge&logo=nextdotjs&logoColor=white&labelColor=000000" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=111111&labelColor=20232A" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=1F5F99" />
  <img alt="Firebase" src="https://img.shields.io/badge/Firebase-Auth%20%2B%20Firestore-FFCA28?style=for-the-badge&logo=firebase&logoColor=111111&labelColor=F57C00" />
  <img alt="Gemini" src="https://img.shields.io/badge/Gemini-API-8E75FF?style=for-the-badge&logo=googlegemini&logoColor=white&labelColor=5B4BC4" />
  <img alt="Groq" src="https://img.shields.io/badge/Groq-Fallback-F55036?style=for-the-badge&logo=groq&logoColor=white&labelColor=201515" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-CSS-38BDF8?style=for-the-badge&logo=tailwindcss&logoColor=white&labelColor=0F172A" />
</p>

---

## Apa Itu JadiPRD?

JadiPRD adalah workspace AI untuk membantu builder, founder, PM, dan peserta hackathon mengubah ide produk yang masih mentah menjadi dokumen yang lebih jelas sebelum masuk tahap eksekusi.

Alih-alih langsung menulis prompt panjang yang mudah melebar, JadiPRD memandu user lewat wawancara singkat, menyusun konteks penting, lalu menghasilkan:

- `PRD.md` untuk kebutuhan produk, fitur, flow, risiko, data, dan batasan.
- `PROMPT_UI.md` untuk arahan UI yang bisa ditempel ke AI builder.
- Versi dokumen agar hasil revisi bisa dibandingkan.
- Revisi per section supaya hemat token dan tidak perlu mengulang semuanya.

## Kenapa Dibuat?

Banyak proses vibe coding gagal bukan karena modelnya jelek, tapi karena konteks awalnya berantakan. JadiPRD menjaga ide tetap terarah sebelum token habis untuk revisi yang seharusnya bisa dicegah dari awal.

Fokus produk ini:

- ringkas, bukan dokumen panjang yang sulit dipakai;
- jelas, bukan AI slop yang penuh asumsi;
- hemat token, karena generate penuh dibatasi dan revisi berjalan per section;
- siap dipakai, bukan sekadar hasil chat.

## Alur Produk

```txt
Ide mentah
  -> Wawancara AI
  -> Ringkasan kebutuhan
  -> PRD.md + PROMPT_UI.md
  -> Review per section
  -> Versi final siap dibawa ke builder / engineering
```

## Fitur

| Area | Detail |
| --- | --- |
| Wawancara AI | Menggali masalah, target pengguna, cakupan MVP, kriteria sukses, data, teknologi, dan arah visual. |
| Rekomendasi AI | Memberi opsi default saat user bingung, dengan alasan yang relevan terhadap konteks produk. |
| Generate PRD | Membuat PRD ringkas berisi requirement, fitur inti, user flow, arsitektur, skema data, dan batasan. |
| UI Prompt | Membuat prompt UI yang jelas untuk screen, komponen, state, interaksi, dan guardrail desain. |
| Revisi Section | User bisa memberi note langsung pada section tertentu tanpa generate ulang seluruh dokumen. |
| Riwayat Akun | Dokumen tersimpan per akun Google dan bisa dibuka lagi dari dashboard. |
| Versi Dokumen | Revisi disimpan sebagai versi baru untuk membandingkan hasil perubahan. |
| Budget Guard | Generate PRD dibatasi per akun, chat/revisi punya limit harian, dan request duplikat dicegah. |

## Tech Stack

| Layer | Teknologi |
| --- | --- |
| App Framework | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS, custom design tokens |
| Auth | Firebase Authentication dengan Google Sign-In |
| Database | Firestore |
| Server SDK | Firebase Admin SDK |
| AI | Gemini API, Groq fallback untuk tugas ringan/sedang |
| Diagram | Mermaid |
| Icons | Lucide React |
| Testing | TypeScript, ESLint, TestSprite E2E |

## Struktur Project

```txt
src/app/page.tsx                 Landing page
src/app/dashboard/page.tsx       Dashboard dan riwayat dokumen
src/app/interview/page.tsx       Wawancara AI
src/app/result/[id]/             Preview PRD, UI Prompt, revisi, versi
src/app/api/chat/route.ts        Endpoint chat interview
src/app/api/generate/route.ts    Endpoint generate PRD
src/app/api/revise/route.ts      Endpoint revisi
src/lib/ai/governance.ts         Quota, dedupe, routing model
src/lib/firebase/                Firebase client/admin
```

## Setup Lokal

Install dependency:

```bash
npm install
```

Buat env lokal:

```bash
cp .env.example .env.local
```

Isi konfigurasi Firebase dan API key AI di `.env.local`.

Jalankan app:

```bash
npm run dev
```

Buka:

```txt
http://localhost:3000
```

## Environment Variables

Firebase client:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Firebase server:

```env
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
```

AI provider:

```env
GEMINI_API_KEY=
GROQ_API_KEY=
AI_PROVIDER=gemini
AI_FALLBACK_PROVIDER=groq
```

Budget guard:

```env
AI_DAILY_CHAT_LIMIT=60
AI_DAILY_REVISE_SECTION_LIMIT=20
AI_DAILY_REVISE_DOCUMENT_LIMIT=3
AI_CHAT_HISTORY_LIMIT=12
AI_DEDUPE_TTL_MS=600000
```

## Quality Check

Typecheck:

```bash
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

Build:

```bash
npm run build
```

## Security Notes

- Jangan commit `.env.local`.
- Jangan commit service account JSON.
- Simpan API key dan private key sebagai secret di environment production.
- Test auth hanya untuk E2E lokal dan harus mati di production.
- Mermaid diagram dirender dengan `securityLevel: "strict"`.

## Status

JadiPRD sedang disiapkan sebagai produk demo/event dengan prioritas:

- alur ide ke PRD yang cepat,
- output yang tidak bertele-tele,
- quota AI yang terkendali,
- pengalaman revisi yang hemat token,
- deployment web yang sederhana.

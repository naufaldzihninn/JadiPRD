import { NextResponse } from "next/server";
import { admin, adminDb } from "@/lib/firebase/admin";

const isTestAuthEnabled =
  process.env.E2E_TEST_AUTH_ENABLED === "true" &&
  process.env.NODE_ENV !== "production";

const testUser = {
  email: process.env.E2E_TEST_EMAIL || "testsprite@jadiprd.local",
  name: process.env.E2E_TEST_NAME || "TestSprite User",
  picture: process.env.E2E_TEST_PHOTO_URL || null,
  uid: process.env.E2E_TEST_UID || "testsprite-local-user",
};

const seededPrd = `# PRD - Sistem Kasir Kafe

## 1. Ringkasan
Sistem kasir dan stok untuk kafe kecil agar transaksi, stok bahan, dan laporan harian lebih rapi.

## 1.1 Masalah
- Kasir masih mencatat transaksi manual.
- Stok bahan sulit dipantau saat ramai.
- Pemilik butuh laporan sederhana tanpa rekap ulang.

## 1.2 Solusi
Aplikasi web responsif untuk kasir, manajemen menu, pengurangan stok otomatis, dan ringkasan penjualan.

## 2. Pengguna
- Pemilik kafe
- Kasir
- Staf operasional

## 3. Fitur MVP
### 3.1 Transaksi Kasir
Kasir memilih menu, sistem menghitung total, dan transaksi tersimpan.

### 3.2 Stok Bahan
Stok bahan berkurang otomatis berdasarkan resep menu.

### 3.3 Laporan Harian
Pemilik melihat total transaksi, produk terlaris, dan stok menipis.

## 4. Kriteria Diterima
- Kasir bisa membuat transaksi kurang dari 30 detik.
- Stok bahan berubah setelah transaksi selesai.
- Laporan harian bisa dibuka tanpa ekspor manual.
`;

const seededUiPrompt = `# UI Prompt - Sistem Kasir Kafe

## Arah Visual
Gunakan visual SaaS yang bersih dengan dominasi hitam, putih, dan kuning hangat. Hindari layout dekoratif berlebihan.

## Route
- /dashboard: ringkasan penjualan, stok menipis, dan shortcut kasir.
- /pos: layar transaksi kasir.
- /inventory: daftar bahan, stok, dan threshold.
- /reports: laporan harian.

## Komponen Utama
- Sidebar navigasi
- Tabel stok
- Panel keranjang transaksi
- Kartu metrik
- Dialog konfirmasi pembayaran

## State
Sediakan empty state, loading state, error state, dan disabled state untuk aksi pembayaran.
`;

async function seedTestWorkspace() {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const outputRef = adminDb.collection("outputs").doc(`${testUser.uid}-kasir-kafe`);
  const sessionRef = adminDb.collection("interview_sessions").doc(`${testUser.uid}-draft-kasir`);

  await adminDb.collection("users").doc(testUser.uid).set(
    {
      email: testUser.email,
      last_seen_at: now,
      name: testUser.name,
      photo_url: testUser.picture,
      provider: "e2e-test",
      uid: testUser.uid,
      updated_at: now,
    },
    { merge: true }
  );

  await outputRef.set(
    {
      ai_model: "e2e-seeded",
      ai_provider: "test",
      product_name: "Sistem Kasir Kafe",
      prd_content: seededPrd,
      project_id: `${testUser.uid}-project-kasir-kafe`,
      qa_score: 95,
      title: "Sistem Kasir Kafe",
      ui_prompt_content: seededUiPrompt,
      updated_at: now,
      user_email: testUser.email,
      user_id: testUser.uid,
      user_name: testUser.name,
      user_photo_url: testUser.picture,
      version: 2,
      created_at: now,
    },
    { merge: true }
  );

  await outputRef.collection("versions").doc("v1").set(
    {
      prd_content: seededPrd.replace("Sistem kasir dan stok", "Draft awal sistem kasir dan stok"),
      revision_mode: "generated",
      ui_prompt_content: seededUiPrompt,
      user_id: testUser.uid,
      version: 1,
      created_at: now,
    },
    { merge: true }
  );

  await outputRef.collection("versions").doc("v2").set(
    {
      prd_content: seededPrd,
      revision_mode: "section_revision",
      section_title: "Arah Visual",
      ui_prompt_content: seededUiPrompt,
      user_id: testUser.uid,
      version: 2,
      created_at: now,
    },
    { merge: true }
  );

  await sessionRef.set(
    {
      last_message: "AI menunggu detail batas MVP dan preferensi visual.",
      message_count: 4,
      messages: [
        {
          id: "message-1",
          role: "ai",
          content: "Halo! Ceritain idemu dong, mau bikin aplikasi seperti apa?",
        },
        {
          id: "message-2",
          role: "user",
          content: "Kasir dan stok untuk kafe kecil.",
        },
        {
          id: "message-3",
          role: "ai",
          content: "Masalah utama apa yang ingin diselesaikan?",
        },
        {
          id: "message-4",
          role: "user",
          content: "Stok sering tidak sinkron dan laporan harian masih manual.",
        },
      ],
      output_id: null,
      status: "draft",
      title: "Kasir dan stok untuk kafe kecil",
      updated_at: now,
      user_email: testUser.email,
      user_id: testUser.uid,
      user_name: testUser.name,
      user_photo_url: testUser.picture,
      created_at: now,
    },
    { merge: true }
  );
}

async function ensureTestAuthUser() {
  const updatePayload: admin.auth.UpdateRequest = {
    displayName: testUser.name,
    email: testUser.email,
    emailVerified: true,
  };

  if (testUser.picture) {
    updatePayload.photoURL = testUser.picture;
  }

  try {
    await admin.auth().updateUser(testUser.uid, updatePayload);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";

    if (code !== "auth/user-not-found") {
      throw error;
    }

    await admin.auth().createUser({
      uid: testUser.uid,
      displayName: testUser.name,
      email: testUser.email,
      emailVerified: true,
      ...(testUser.picture ? { photoURL: testUser.picture } : {}),
    });
  }
}

export async function POST(req: Request) {
  if (!isTestAuthEnabled) {
    return NextResponse.json({ error: "Test auth tidak aktif." }, { status: 404 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { seed?: boolean };

    if (body.seed !== false) {
      await seedTestWorkspace();
    }

    await ensureTestAuthUser();

    const token = await admin.auth().createCustomToken(testUser.uid, {
      email: testUser.email,
      name: testUser.name,
      provider: "e2e-test",
    });

    return NextResponse.json({
      success: true,
      token,
      user: testUser,
    });
  } catch (error) {
    console.error("Gagal membuat login test", error);
    return NextResponse.json(
      { error: "Gagal menyiapkan login test." },
      { status: 500 }
    );
  }
}

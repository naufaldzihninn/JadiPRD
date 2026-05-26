import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  getAuthenticatedUser,
  isUnauthenticatedError,
  touchUserProfile,
} from "@/lib/firebase/auth-admin";

function timestampToIso(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().toISOString();
  }

  return null;
}

function serializeVersionDoc(id: string, data: Record<string, unknown>) {
  return {
    id,
    created_at: timestampToIso(data.created_at),
    prd_content: typeof data.prd_content === "string" ? data.prd_content : "",
    revision_mode: typeof data.revision_mode === "string" ? data.revision_mode : null,
    section_title: typeof data.section_title === "string" ? data.section_title : null,
    ui_prompt_content:
      typeof data.ui_prompt_content === "string" ? data.ui_prompt_content : "",
    version: typeof data.version === "number" ? data.version : 1,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    const { id } = await params;
    const outputRef = adminDb.collection("outputs").doc(id);
    const outputSnap = await outputRef.get();

    if (!outputSnap.exists) {
      return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
    }

    const outputData = outputSnap.data() || {};
    const ownerId = outputData.user_id;

    if (ownerId && ownerId !== user.uid) {
      return NextResponse.json({ error: "Kamu tidak punya akses ke dokumen ini." }, { status: 403 });
    }

    await touchUserProfile(user);

    const versionsSnap = await outputRef
      .collection("versions")
      .orderBy("version", "asc")
      .get();

    const versions = versionsSnap.docs.map((doc) =>
      serializeVersionDoc(doc.id, doc.data())
    );

    if (versions.length === 0) {
      versions.push(
        serializeVersionDoc("current", {
          created_at: outputData.created_at,
          prd_content: outputData.prd_content,
          ui_prompt_content: outputData.ui_prompt_content,
          version: typeof outputData.version === "number" ? outputData.version : 1,
        })
      );
    }

    return NextResponse.json({ success: true, versions });
  } catch (error: unknown) {
    console.error("Gagal mengambil versi output", error);
    if (isUnauthenticatedError(error)) {
      return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Gagal mengambil versi dokumen." },
      { status: 500 }
    );
  }
}

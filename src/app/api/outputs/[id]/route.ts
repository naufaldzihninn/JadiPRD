import { NextRequest, NextResponse } from "next/server";
import { adminDb, admin } from "@/lib/firebase/admin";
import {
  getAuthenticatedUser,
  isUnauthenticatedError,
  touchUserProfile,
} from "@/lib/firebase/auth-admin";

interface UpdateOutputPayload {
  prd_content?: string;
  ui_prompt_content?: string;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(req);
    const { id } = await params;
    const payload = (await req.json()) as UpdateOutputPayload;

    const hasPrdUpdate = typeof payload.prd_content === "string";
    const hasUiPromptUpdate = typeof payload.ui_prompt_content === "string";

    if (!hasPrdUpdate && !hasUiPromptUpdate) {
      return NextResponse.json(
        { error: "No valid fields to update." },
        { status: 400 }
      );
    }

    const docRef = adminDb.collection("outputs").doc(id);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return NextResponse.json({ error: "Dokumen tidak ditemukan." }, { status: 404 });
    }

    const outputData = docSnap.data() || {};
    const ownerId = outputData.user_id;

    if (ownerId && ownerId !== user.uid) {
      return NextResponse.json({ error: "Kamu tidak punya akses ke dokumen ini." }, { status: 403 });
    }

    const currentVersion = typeof outputData.version === "number" ? outputData.version : 1;
    const nextVersion = currentVersion + 1;
    const versionId = `v${nextVersion}`;
    const nextPrdContent = hasPrdUpdate
      ? payload.prd_content || ""
      : typeof outputData.prd_content === "string"
        ? outputData.prd_content
        : "";
    const nextUiPromptContent = hasUiPromptUpdate
      ? payload.ui_prompt_content || ""
      : typeof outputData.ui_prompt_content === "string"
        ? outputData.ui_prompt_content
        : "";
    const updates: Record<string, unknown> = {
      last_edited_by: user.uid,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      version: nextVersion,
    };

    if (hasPrdUpdate) {
      updates.prd_content = payload.prd_content;
    }

    if (hasUiPromptUpdate) {
      updates.ui_prompt_content = payload.ui_prompt_content;
    }

    await touchUserProfile(user);
    await docRef.update(updates);
    await docRef.collection("versions").doc(versionId).set({
      prd_content: nextPrdContent,
      revision_mode: "manual_edit",
      ui_prompt_content: nextUiPromptContent,
      user_id: user.uid,
      version: nextVersion,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      version: nextVersion,
      version_id: versionId,
    });
  } catch (error: unknown) {
    console.error("Gagal memperbarui output", error);
    if (isUnauthenticatedError(error)) {
      return NextResponse.json({ error: "Login diperlukan." }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Gagal memperbarui output." },
      { status: 500 }
    );
  }
}

import { NextRequest } from "next/server";
import { admin, adminDb, getAdminAuth } from "@/lib/firebase/admin";

export interface AuthenticatedUser {
  email: string | null;
  name: string | null;
  picture: string | null;
  uid: string;
}

export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser> {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    throw new Error("UNAUTHENTICATED");
  }

  const decodedToken = await getAdminAuth().verifyIdToken(token);

  return {
    email: decodedToken.email || null,
    name: decodedToken.name || null,
    picture: decodedToken.picture || null,
    uid: decodedToken.uid,
  };
}

export async function touchUserProfile(user: AuthenticatedUser) {
  await adminDb.collection("users").doc(user.uid).set(
    {
      email: user.email,
      last_seen_at: admin.firestore.FieldValue.serverTimestamp(),
      name: user.name,
      photo_url: user.picture,
      provider: "google",
      uid: user.uid,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export function isUnauthenticatedError(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHENTICATED";
}

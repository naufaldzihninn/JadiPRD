import * as admin from 'firebase-admin';

function getAdminApp() {
  if (admin.apps.length) {
    return admin.app();
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin belum dikonfigurasi. Pastikan NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, dan FIREBASE_ADMIN_PRIVATE_KEY tersedia."
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      clientEmail,
      privateKey,
      projectId,
    }),
  });
}

function getAdminDb() {
  return admin.firestore(getAdminApp());
}

function getAdminAuth() {
  return admin.auth(getAdminApp());
}

const adminDb = new Proxy({} as FirebaseFirestore.Firestore, {
  get(_target, prop, receiver) {
    const db = getAdminDb();
    const value = Reflect.get(db, prop, receiver);
    return typeof value === "function" ? value.bind(db) : value;
  },
});

export { adminDb, admin, getAdminApp, getAdminAuth, getAdminDb };

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function assertFirebaseClientConfig() {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Firebase client config belum lengkap: ${missing.join(", ")}`);
  }
}

function getClientApp() {
  if (typeof window === "undefined") {
    throw new Error("Firebase client hanya boleh dipakai di browser.");
  }

  assertFirebaseClientConfig();
  return !getApps().length ? initializeApp(firebaseConfig) : getApp();
}

function getClientAuth() {
  return getAuth(getClientApp());
}

function getClientDb() {
  return getFirestore(getClientApp());
}

const auth = new Proxy({} as Auth, {
  get(_target, prop, receiver) {
    const clientAuth = getClientAuth();
    const value = Reflect.get(clientAuth, prop, receiver);
    return typeof value === "function" ? value.bind(clientAuth) : value;
  },
});

const db = new Proxy({} as Firestore, {
  get(_target, prop, receiver) {
    const clientDb = getClientDb();
    const value = Reflect.get(clientDb, prop, receiver);
    return typeof value === "function" ? value.bind(clientDb) : value;
  },
});

export { auth, db, getClientApp, getClientAuth, getClientDb };

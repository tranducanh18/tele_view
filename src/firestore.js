const admin = require('firebase-admin');

if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Production: Render / GitHub Actions
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else {
    // Local development
    credential = admin.credential.cert(require('../serviceAccountKey.json'));
  }
  admin.initializeApp({ credential });
}

const db = admin.firestore();

const DEFAULT_SETTINGS = {
  intervalMinutes: 60,
  maxVideos: 30,
  viewThreshold: 10000,
};

async function loadUser(chatId) {
  const docRef = db.collection('users').doc(String(chatId));
  const doc = await docRef.get();

  if (!doc.exists) {
    const newData = {
      pages: [],
      settings: { ...DEFAULT_SETTINGS },
      seenVideos: {},
    };
    await docRef.set(newData);
    return newData;
  }
  return doc.data();
}

async function saveUser(chatId, userData) {
  await db.collection('users').doc(String(chatId)).set(userData, { merge: true });
}

async function getAllUsers() {
  const snapshot = await db.collection('users').get();
  const users = {};
  snapshot.forEach((doc) => {
    users[doc.id] = doc.data();
  });
  return users;
}

module.exports = { loadUser, saveUser, getAllUsers, DEFAULT_SETTINGS };

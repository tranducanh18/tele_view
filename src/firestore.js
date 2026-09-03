const admin = require('firebase-admin');

if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else {
    credential = admin.credential.cert(require('../serviceAccountKey.json'));
  }
  admin.initializeApp({ credential });
}

const db = admin.firestore();

const DEFAULT_SETTINGS = {
  intervalMinutes: 60,
  maxVideos: 30,
  viewThreshold: 10000,   // mốc 1 (lần đầu báo)
  viewThreshold2: 0,      // mốc 2 (lần 2 báo). 0 = tắt
  remindMinutes: 0,
  lastRemindAt: null,
  lastCheckedAt: null,    // lần check gần nhất (dùng cho cron)
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

  const data = doc.data();
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  if (!data.seenVideos) data.seenVideos = {};
  if (!data.pages) data.pages = [];
  return data;
}

async function saveUser(chatId, userData) {
  await db.collection('users').doc(String(chatId)).set(userData, { merge: true });
}

async function getAllUsers() {
  const snapshot = await db.collection('users').get();
  const users = {};
  snapshot.forEach((doc) => {
    const data = doc.data();
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    users[doc.id] = data;
  });
  return users;
}

module.exports = { loadUser, saveUser, getAllUsers, DEFAULT_SETTINGS };
const admin = require("firebase-admin");
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = db;

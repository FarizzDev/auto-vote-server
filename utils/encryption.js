const crypto = require("crypto");
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const key = Buffer.from(process.env.SECRET_KEY);

function encrypt(text) {
  const iv = crypto.randomBytes(12); // IV 12 byte = 96 bit (standar GCM)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encryptedBase64) {
  const data = Buffer.from(encryptedBase64, "base64");

  const iv = data.slice(0, 12);
  const tag = data.slice(12, 28);
  const ciphertext = data.slice(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encrypt,
  decrypt
}

const fetch = require("node-fetch");
const db = require("./firestore.js");
const { decrypt } = require("./utils/encryption.js");
const webData = require("./webData.json");

// --- CONFIGURATION ---
const BROWSERLESS_ENDPOINT =
  "https://production-sfo.browserless.io/chromium/bql";
const PROXY_STRING = "&proxy=residential&proxyCountry=us";
const OPTIONS_STRING = "&blockAds=true";

// --- TOKEN MANAGEMENT ---
const TokenManager = {
  tokens: [],
  currentIndex: 0,

  async initialize() {
    console.log("Initializing token pool...");
    const usersSnapshot = await db.collection("users").get();
    const dbTokens = usersSnapshot.docs
      .map((doc) => doc.data().token)
      .filter(
        (token) => token && typeof token === "string" && token.trim() !== "",
      )
      .map((token) => decrypt(token));

    if (dbTokens.length > 0) {
      console.log(`Found ${dbTokens.length} tokens from Firestore.`);
      this.tokens = dbTokens;
    } else {
      // Fallback token
      console.log("Token not found, trying to check environment variables...");
      const fallbackTokens = process.env.FALLBACK_TOKENS || "";
      this.tokens = fallbackTokens.split(",").filter((t) => t.trim() !== "");

      if (this.tokens.length > 0) {
        console.log(`Found ${this.tokens.length} tokens from FALLBACK_TOKENS.`);
      } else {
        console.error("❌ ERROR: Token not found in Firebase and ENV.");
      }
    }
  },

  getToken() {
    if (this.tokens.length === 0) return null;
    return this.tokens[this.currentIndex];
  },

  // Switch to next token (round-robin)
  switchToNextToken() {
    if (this.tokens.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.tokens.length;
    console.log(`Switching to next token (index: ${this.currentIndex}).`);
  },
};

async function loadAllUsers() {
  console.log("Fetching data from Firestore...");
  const serversSnapshot = await db
    .collectionGroup("servers")
    .where("expired", ">", new Date())
    .get();

  const users = {};

  for (const serverDoc of serversSnapshot.docs) {
    const serverData = serverDoc.data();
    // get user nickname from (users/{nickname}/servers/{serverId})
    const nickname = serverDoc.ref.parent.parent.id;

    if (!users[nickname]) {
      users[nickname] = {
        nickname: nickname,
        servers: [],
      };
    }

    users[nickname].servers.push({
      server_id: serverDoc.id,
      ...serverData,
    });
  }
  console.log(`Found ${Object.keys(users).length} active user.`);
  return Object.values(users);
}

/**
 * Vote to server
 * @async
 * @param {string} serverId - Server ID in Minecraft Pocket Servers
 * @param {string} nickname
 * @param {string} token - Browserless Token
 * @returns {boolean} - true if success, false if token exhaust/too many request.
 */
async function voteForServer(
  { URL, nicknameSelector, acceptSelector, submitSelector },
  { serverId, nickname },
  token,
) {
  const query = `
    mutation VoteServer {
      reject(type: [image, media]) {
        enabled
      }
      goto(url: "${URL.replace("{serverId}", serverId)}") {
        status
      }
      waitForForm: waitForSelector( selector: "${nicknameSelector}", visible: true ) { time }
      type(text: "${nickname}", selector: "${nicknameSelector}", timeout: 1000.0 ) { time }
      click(selector: "${acceptSelector}") { time }
      verify(type: cloudflare) { solved }
      waitForTimeout(time: 1000.0) { time }
      submit: click(selector: "${submitSelector}") { time }
    }
  `;

  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: query,
      operationName: "VoteServer",
    }),
  };
  const url = `${BROWSERLESS_ENDPOINT}?token=${token}${PROXY_STRING}${OPTIONS_STRING}`;

  try {
    const response = await fetch(url, options);
    if (response.status === 429) {
      console.warn(
        `⚠️ Token ${token.substring(0, 3)}... maybe exhaust (Status 429).`,
      );
      return false;
    }
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const { data } = await response.json();

    console.log(
      `✅ Vote success for ${nickname} in server ${serverId}. Typing time: ${data.type.time}`,
    );
    return true;
  } catch (error) {
    console.error(
      `❌ Failed to vote for ${nickname} in server ${serverId}:`,
      error.message,
    );
    return true;
  }
}

async function main() {
  await TokenManager.initialize();

  if (TokenManager.tokens.length === 0) {
    return;
  }

  console.log("🚀 Voting...");
  const users = await loadAllUsers();

  if (users.length === 0) {
    console.log("Active user or server not found.");
    return;
  }

  for (const user of users) {
    console.log(`\n--- Processing for user: ${user.nickname} ---`);
    for (const server of user.servers) {
      let voteSuccess = false;
      let attempts = 0;

      while (!voteSuccess && attempts < TokenManager.tokens.length) {
        const currentToken = TokenManager.getToken();
        console.log(
          `   -> Trying to vote server with ID: ${server.server_id} with token id ${TokenManager.currentIndex}`,
        );

        voteSuccess = await voteForServer(
          webData[server.platformId],
          {
            serverId: server.server_id,
            nickname: user.nickname,
          },
          currentToken,
        );

        if (!voteSuccess) {
          TokenManager.switchToNextToken();
          attempts++;
          if (attempts >= TokenManager.tokens.length) {
            console.error(
              `❌ ALL TOKEN FAILED to vote server ${server.server_id}.  Voting for next server.`,
            );
          }
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log("\n✅ All vote was done.");
}

main().catch(console.error);

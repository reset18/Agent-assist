import sqlite3 from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let dbPath = path.resolve('./data/memory.db');
if (!fs.existsSync(dbPath)) {
    dbPath = path.resolve('./data/agent-assist.db');
}
if (!fs.existsSync(dbPath)) {
    dbPath = path.resolve('../data/agent-assist.db'); // case for dist/
}
const db = new sqlite3(dbPath);

// Fetch an OAuth token for Copilot or OpenAI
const stmt = db.prepare("SELECT value FROM settings WHERE key = 'llm_api_key' LIMIT 1");
const row = stmt.get();
let apiKey = row ? row.value : null;

if (!apiKey) {
  const accountStmt = db.prepare("SELECT value FROM settings WHERE key = 'llm_accounts' LIMIT 1");
  const accRow = accountStmt.get();
  if (accRow) {
      const accounts = JSON.parse(accRow.value);
      const oauthAcc = accounts.find(a => a.isOauth && a.apiKey);
      if (oauthAcc) apiKey = oauthAcc.apiKey;
  }
}

if (!apiKey) {
    console.error("No OAuth token found in DB.");
    process.exit(1);
}

const formatsToTest = [
    // 1. Standard OpenAI (What we tried in v0.2.53 and got tools[0].name)
    [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: {} } }],
    
    // 2. Flat format (What we tried in v0.2.57 and got Unsupported tool type: None)
    [{ name: "get_weather", description: "Get weather", parameters: {} }],
    
    // 3. Semi-flat format (What we tried in v0.2.58 and got Unsupported tool type: None)
    [{ type: "function", name: "get_weather", description: "Get weather", parameters: {} }],

    // 4. Action format?
    [{ type: "action", name: "get_weather", description: "Get weather", parameters: {} }],

    // 5. Tool format?
    [{ type: "tool", function: { name: "get_weather", description: "Get weather", parameters: {} } }]
];

async function testFormat(idx, tools) {
    const body = {
        model: "gpt-5.4",
        input: [{ role: "user", content: "hi" }],
        store: false,
        stream: false,
        tools: tools
    };

    console.log(`\nTesting Format ${idx + 1}...`);
    const res = await fetch('https://chatgpt.com/backend-api/codex/responses', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        console.log(`❌ Failed: HTTP ${res.status}`);
        console.log(errText);
    } else {
        console.log(`✅ Success!`);
        console.log(await res.text());
    }
}

async function runTests() {
    for (let i = 0; i < formatsToTest.length; i++) {
        await testFormat(i, formatsToTest[i]);
    }
}

runTests().catch(console.error);

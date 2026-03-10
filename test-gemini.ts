import { chatCompletion } from './src/agent/llm.js';
import { initDb } from './src/db/index.js';

async function test() {
    initDb();
    try {
        console.log("Testing fake gemini key...");
        const res = await chatCompletion('gemini-1.5-flash', 'google', [{ role: 'user', content: 'hello' }], [], 'FAKE_KEY_123456');
        console.log("SUCCESS:", res);
    } catch (e) {
        console.error("ERROR CAUGHT:", e);
    }
}
test();

const body = {
    provider: 'google',
    apiKey: 'FAKED_KEY_HERE_123'
};

async function test() {
    try {
        const res = await fetch('http://localhost:3005/api/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        console.log("Status:", res.status);
        const data = await res.text();
        console.log("Response:", data);
    } catch (e) {
        console.log("Fetch failed:", e);
    }
}
test();

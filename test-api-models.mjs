async function test() {
    console.log("Testing POST /api/models with fake key for Google");
    try {
        const res = await fetch("http://localhost:3005/api/models", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider: 'google',
                apiKey: 'FAAAKKEE_1234'
            })
        });
        const status = res.status;
        console.log("Status:", status);
        const text = await res.text();
        console.log("Body:", text);
    } catch(e) {
        console.log("Error:", e);
    }
}
test();

async function testFetch() {
    const url = "https://generativelanguage.googleapis.com/v1beta/models?key=AAAABBBBCCCC";
    const res = await fetch(url);
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text);
}
testFetch();

require('dotenv').config();
const { handler } = require('./netlify/functions/notion.js');

async function debug() {
    console.log("=== STARTING DEBUG ===");
    const res = await handler({ httpMethod: 'GET' });
    console.log("Status Code:", res.statusCode);
    
    if (res.statusCode === 200) {
        const data = JSON.parse(res.body);
        console.log("Total Locations Extracted:", data.length);
    } else {
        console.error("Error:", res.body);
    }
    console.log("=== DONE ===");
}
debug();

require('dotenv').config();
const handler = require('./api/notion.js');

async function debug() {
    console.log("=== STARTING DEBUG (VERCEL MODE) ===");
    
    // Mock request and response
    const req = { method: 'GET' };
    const res = {
        status: (code) => {
            console.log("Status Code:", code);
            return res;
        },
        json: (data) => {
            if (data.error) {
                console.error("Error:", data.error);
            } else {
                const count = (data.locations?.length || 0) + (data.needResolve?.length || 0);
                console.log("Total Customers Found:", data.stats?.totalCustomers || 0);
                console.log("Mapped Customers:", count);
            }
            return res;
        },
        setHeader: () => res,
        end: () => res
    };

    await handler(req, res);
    console.log("=== DONE ===");
}
debug();

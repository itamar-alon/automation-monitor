require('dotenv').config();
const puppeteer = require('puppeteer');

// --- Function to send alert via Courier API ---
async function sendAlertViaCourier(zip) {
    const apiKey = process.env.COURIER_API_KEY;
    const email = process.env.MY_EMAIL;

    if (!apiKey || !email) {
        console.error(">>> Error: Missing COURIER_API_KEY or MY_EMAIL in .env file");
        return;
    }

    const url = 'https://api.courier.com/send';
    
    const body = {
        message: {
            to: {
                email: email
            },
            content: {
               
                title: "התראה: אי חזרת מידע בממשקי אוטומציה באזור האישי ⚠️",
                body: `יש לוודא את תקינות נתוני האוטומציה בממשקים השונים באזור האישי.`
            },
            routing: {
                method: "single",
                channels: ["email"]
            }
        }
    };

    try {
        console.log(">>> Sending request to Courier API...");
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`HTTP Error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        console.log(`>>> ✅ Email sent successfully! Message ID: ${data.requestId}`);

    } catch (error) {
        console.error(">>> ❌ Error sending email:", error.message);
    }
}

// --- Main Execution ---
(async () => {
    // Browser Launch Settings
    const browser = await puppeteer.launch({ 
        headless: "new", 
        defaultViewport: null,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', 
            '--single-process'        
    ] 
});
    
    const page = await browser.newPage();

    try {
        console.log(`>>> Navigating to Arnona page...`);
        await page.goto('https://my.rishonlezion.muni.il/arnona/', { waitUntil: 'networkidle2' });

        // Login Process
        const mainLoginBtn = 'button::-p-text(התחברות)';
        await page.waitForSelector(mainLoginBtn, { visible: true, timeout: 15000 });
        await page.click(mainLoginBtn);

        const tabSelector = 'button::-p-text(באמצעות סיסמה)';
        await page.waitForSelector(tabSelector, { visible: true, timeout: 10000 });
        await page.click(tabSelector);

        await page.waitForSelector('input[name="tz"]', { visible: true });
        await page.type('input[name="tz"]', process.env.USER_ID, { delay: 100 });
        await page.type('input[name="password"]', process.env.USER_PASS, { delay: 100 });

        console.log(">>> Logging in...");
        await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
        ]);

        // Wait for data to load
        await new Promise(r => setTimeout(r, 12000));

        // Extract Zip Code
        const zipValue = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, td, div, p'));
            const zipElement = elements.find(el => {
                const text = el.innerText ? el.innerText.trim() : "";
                return text.match(/^\d{7}$/);
            });
            return zipElement ? zipElement.innerText.trim() : null;
        });

        console.log(`>>> Zip code found on site: ${zipValue}`);

        // --- Validation Check ---
        if (zipValue && zipValue.trim() !== "7570727") {
            console.log('>>> ⚠️ Zip code is invalid! Triggering alert...');
            await sendAlertViaCourier(zipValue);
        } else if (!zipValue) {
             console.log('>>> ⚠️ No zip code found! Triggering alert...');
             await sendAlertViaCourier("Empty / Not Found");
        } else {
            console.log('>>> Zip code is valid (7570727). No alert needed.');
        }

    } catch (error) {
        console.error('>>> Error in process:', error.message);
    } finally {
        await browser.close();
        console.log('>>> Process finished.');
    }
})();
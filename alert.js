require('dotenv').config();
const puppeteer = require('puppeteer');

// --- Function to send alert via Courier API ---
async function sendAlertViaCourier(zip) {
    const apiKey = process.env.COURIER_API_KEY;
    const email = process.env.MY_EMAIL;

    if (!apiKey || !email) {
        console.error(">>> Error: Missing COURIER_API_KEY or MY_EMAIL");
        return;
    }

    const url = 'https://api.courier.com/send';
    const body = {
        message: {
            to: { email: email },
            content: {
                title: "התראה: אי חזרת מידע בממשקי אוטומציה באזור האישי ⚠️",
                body: `יש לוודא את תקינות נתוני האוטומציה בממשקים השונים באזור האישי. ערך שנמצא: ${zip}`
            },
            routing: { method: "single", channels: ["email"] }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        console.log(`>>> ✅ Email sent! ID: ${data.requestId}`);
    } catch (error) {
        console.error(">>> ❌ Error sending email:", error.message);
    }
}

(async () => {
    const browser = await puppeteer.launch({ 
        headless: "new", 
        defaultViewport: { width: 1280, height: 800 },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    try {
        console.log(`>>> Navigating to Arnona page...`);
        await page.goto('https://my.rishonlezion.muni.il/arnona/', { waitUntil: 'networkidle2' });

        const maintenanceText = await page.evaluate(() => {
            return document.body.innerText.includes("האתר בעבודות תחזוקה");
        });

        if (maintenanceText) {
            console.log(">>> 🛑 Site is under maintenance. Skipping check and not sending email.");
            return; 
        }

        const mainLoginBtn = 'button::-p-text(התחברות)';
        await page.waitForSelector(mainLoginBtn, { visible: true, timeout: 15000 });
        await page.click(mainLoginBtn);

        const tabSelector = 'button::-p-text(באמצעות סיסמה)';
        await page.waitForSelector(tabSelector, { visible: true, timeout: 10000 });
        await page.click(tabSelector);

        await page.waitForSelector('input[name="tz"]', { visible: true });
        await page.type('input[name="tz"]', process.env.USER_ID);
        await page.type('input[name="password"]', process.env.USER_PASS);

        console.log(">>> Logging in...");
        await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
        ]);

        await new Promise(r => setTimeout(r, 15000));
        await page.screenshot({ path: 'debug_arnona_screen.png', fullPage: true });

        const isLoggedIn = await page.evaluate(() => {
            return document.body.innerText.includes("ארנונה") || document.body.innerText.includes("ניתוק");
        });

        if (!isLoggedIn) {
            console.log(">>> ⚠️ Could not verify successful login. Site might be blocked or slow. No email sent.");
            return;
        }

        const zipValue = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, td, div, p'));
            const zipElement = elements.find(el => el.innerText && el.innerText.trim().match(/^\d{7}$/));
            return zipElement ? zipElement.innerText.trim() : null;
        });

        console.log(`>>> Zip code found: ${zipValue}`);

        if (zipValue && zipValue.trim() !== "7570727") {
            console.log('>>> ⚠️ Invalid Zip! Sending alert...');
            await sendAlertViaCourier(zipValue);
        } else if (!zipValue) {
             console.log('>>> ⚠️ No zip found on a loaded page! Sending alert...');
             await sendAlertViaCourier("Not Found");
        } else {
            console.log('>>> ✅ Everything is OK.');
        }

    } catch (error) {
        console.error('>>> ❌ Error:', error.message);
    } finally {
        await browser.close();
        console.log('>>> Process finished.');
    }
})();

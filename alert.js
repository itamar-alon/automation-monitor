require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { execSync } = require('child_process');

// --- הגדרות בדיקה ---
const SEND_EMAIL = false; // true = שולח מייל אמת, false = רק מדפיס לוג

// --- פרטי הזדהות ומשתני סביבה ---
const ID = process.env.USER_ID;
const PASS = process.env.USER_PASS;

const TARGETS = [
    {
        name: "Prod_Check",
        env: "prod",
        url: 'https://my.rishonlezion.muni.il/arnona/',
        expectedText: "7570727",
        alertTitle: "תקלה בייצור: אי חזרת מידע בממשקי אוטומציה ⚠️"
    },
    {
        name: "Test_Check",
        env: "test",
        url: 'https://mytest.rishonlezion.muni.il/arnona/',
        expectedText: "7570727",
        alertTitle: "תקלה בטסט: אי חזרת מידע בממשקי אוטומציה ⚠️"
    }
];

const logDirectory = path.join(__dirname, 'logs');
const screenshotsDirectory = path.join(logDirectory, 'screenshots');

if (!fs.existsSync(logDirectory)) fs.mkdirSync(logDirectory);
if (!fs.existsSync(screenshotsDirectory)) fs.mkdirSync(screenshotsDirectory);

let CURRENT_ENV = "unknown";
const lokiPromises = [];

// --- Logger Setup ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'DD-MM-YYYY HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}]: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new DailyRotateFile({ filename: path.join(logDirectory, 'rishon-app-%DATE%.log'), datePattern: 'YYYY-MM-DD', zippedArchive: true, maxSize: '20m', maxFiles: '14d' })
    ]
});

// --- שליחת מייל ---
async function sendAlertEmail(target, errorMessage) {
    if (!SEND_EMAIL) {
        logger.warn(`>>> 🔕 SIMULATION: Would send email to ${process.env.MY_EMAIL}`);
        return;
    }

    const apiKey = process.env.COURIER_API_KEY;
    const emailString = process.env.MY_EMAIL;

    if (!apiKey || !emailString) {
        logger.warn(">>> ⚠️ Courier credentials missing in .env");
        return;
    }

    const recipients = emailString.split(',').map(email => ({ email: email.trim() }));
    const url = 'https://api.courier.com/send';

    const body = {
        message: {
            to: recipients,
            content: {
                title: target.alertTitle,
                body: `נמצאה שגיאה בתהליך האוטומציה בסביבת ${target.env}.\n\nשגיאה: ${errorMessage}\nזמן: ${new Date().toLocaleString('he-IL')}`
            },
            routing: { method: "all", channels: ["email"] }
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

        if (response.ok) {
            const data = await response.json();
            logger.info(`>>> 📧 Alert email sent. ID: ${data.requestId}`);
        } else {
            logger.error(`>>> ❌ Courier API Error: ${response.statusText}`);
        }
    } catch (e) {
        logger.error(`>>> ❌ Email sending failed: ${e.message}`);
    }
}

// --- שליחת לוגים ל-Loki ---
async function sendToLoki(level, message, targetEnv) {
    const url = 'http://127.0.0.1:3100/loki/api/v1/push';
    const nanoseconds = (Date.now() * 1000000).toString();

    const payload = {
        streams: [{
            stream: {
                job: "rishon-qa-automation",
                severity: level,
                target_env: targetEnv
            },
            values: [[nanoseconds, message]]
        }]
    };

    try {
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) {}
}

logger.on('data', (log) => {
    lokiPromises.push(sendToLoki(log.level, log.message, CURRENT_ENV));
});

// --- Cleanup ---
try {
    const processList = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH').toString();
    if (processList.includes("chrome.exe")) {
        execSync('taskkill /F /IM chrome.exe /T');
        logger.info(">>> 🧹 Cleanup: Zombies killed.");
    }
} catch (e) {}

// --- צילום מסך (ברזולוציה 1280x800) ---
async function takeFullScreenshot(page, stepName) {
    try {
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
        const fileName = `FAIL_${stepName}_${timestamp}.png`;
        const filePath = path.join(screenshotsDirectory, fileName);

        await page.setViewport({ width: 1280, height: 800 });

        await page.addStyleTag({
            content: `html, body { height: auto !important; overflow: visible !important; }`
        });

        await page.screenshot({ path: filePath, fullPage: true });
        logger.info(`>>> 🖼️ Screenshot saved: ${fileName}`);
    } catch (e) { logger.error(`>>> ⚠️ Screenshot failed: ${e.message}`); }
}

// --- Helper: Run Step ---
async function runStep(page, stepName, action, target) {
    logger.info(`>>> ⏳ Step Started: ${stepName}`);
    try {
        await action();
        logger.info(`>>> ✅ Step Passed: ${stepName}`);
    } catch (error) {
        logger.error(`>>> 🚩 RED FLAG at step: [${stepName}]`);
        await takeFullScreenshot(page, stepName);
        if (stepName.includes("Verify_Data") && target) {
            await sendAlertEmail(target, error.message);
        }
        throw error;
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function clickViaJS(page, element) {
    await page.evaluate(el => el.click(), element);
}

// --- Login Logic ---
async function handleLogin(page) {
    try {
        logger.info(">>> 🔐 Starting login flow...");
        
        // הגדלת timeout ל-20 שניות למקרה שהאתר איטי
        const topLoginBtn = await page.waitForSelector("xpath///button[contains(., 'כניסה')] | //a[contains(., 'כניסה')]", { timeout: 20000 });
        await topLoginBtn.click();
        await sleep(3000); // המתנה קצרה אחרי לחיצה

        try {
            const passwordTab = await page.waitForSelector("xpath///button[contains(., 'באמצעות סיסמה')]", { visible: true, timeout: 5000 });
            await clickViaJS(page, passwordTab);
            await sleep(1000);
        } catch (e) {}

        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 10000 });
        const tzInput = await page.waitForSelector('input[name="tz"]');
        await tzInput.type(ID, { delay: 50 });
        const passInput = await page.waitForSelector('input[name="password"]');
        await passInput.type(PASS, { delay: 50 });

        const submitBtn = await page.waitForSelector("xpath///div[contains(@class, 'MuiDialog')]//button[contains(., 'כניסה')]");
        await clickViaJS(page, submitBtn);

        // כאן השינוי החשוב: מחכים שהמודאל ייעלם
        try {
            await page.waitForFunction(() => !document.querySelector('.MuiDialog-container'), { timeout: 15000 });
        } catch(e) {}

        // המתנה לניווט
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        
    } catch (e) {
        logger.error(`>>> ❌ Login Failed: ${e.message}`);
        throw e;
    }
}

// --- MAIN ---
(async () => {
    setTimeout(() => { process.exit(1); }, 20 * 60 * 1000);
    logger.info(">>> 🚀 Starting RiZone QA Automation");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: "C:\\Users\\itamara\\.cache\\puppeteer\\chrome\\win64-143.0.7499.169\\chrome-win64\\chrome.exe",
            args: ['--no-sandbox', '--window-size=1280,800']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        
        for (const target of TARGETS) {
            CURRENT_ENV = target.env;
            logger.info(`>>> 🔄 Checking ${target.name} (${CURRENT_ENV})`);

            try {
                await runStep(page, `${target.name}__Nav`, async () => {
                    await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 60000 });
                }, target);

                await runStep(page, `${target.name}__Login`, async () => {
                    await handleLogin(page);
                }, target);

                await runStep(page, `${target.name}__Verify_Data`, async () => {
                    logger.info(">>> ⏳ Waiting for heavy data to load...");
                    
                    // שלב 1: המתנה אגרסיבית לטעינת השלד של האתר (מילים כלליות)
                    // זה מבטיח שאנחנו לא בודקים על מסך ריק
                    try {
                        await page.waitForFunction(
                            () => document.body.innerText.includes("נכסים") || document.body.innerText.includes("שלום"),
                            { timeout: 60000 } // נותן לו דקה שלמה רק להיטען
                        );
                    } catch (e) {
                        logger.warn(">>> ⚠️ Dashboard took too long to render structure, proceeding to check loop anyway...");
                    }

                    // שלב 2: המתנה קצרה לרגיעה ברשת (AJAX calls)
                    try {
                        await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 });
                    } catch(e) {}

                    // שלב 3: בדיקת הנתון הספציפי
                    const startTime = Date.now();
                    const TIMEOUT_MS = 180000; // 3 דקות המתנה לנתון עצמו
                    
                    while (Date.now() - startTime < TIMEOUT_MS) {
                        const content = await page.evaluate(() => document.body.innerText);
                        if (content.includes(target.expectedText)) {
                            logger.info(`>>> ✅ SUCCESS on ${target.name}`);
                            return;
                        }
                        await sleep(2000); // בדיקה כל 2 שניות במקום כל שנייה
                    }
                    throw new Error("Data validation failed: Expected text not found after full timeout");
                }, target);

            } catch (e) { logger.warn(`>>> ⚠️ Target failed: ${e.message}`); }
        }
    } catch (e) { logger.error(`>>> 💥 Fatal: ${e.message}`); } finally {
        await Promise.all(lokiPromises);
        await sleep(2000);
        if (browser) await browser.close();
        process.exit(0);
    }
})();
require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { execSync } = require('child_process');

// --- Configuration ---
const SEND_EMAIL = true;
const ID = process.env.USER_ID;
const PASS = process.env.USER_PASS;
const TIMEOUT_MS = 180000; // 3 דקות המתנה לנתונים

// מילים שמעידות על כישלון קריטי בדף (Fail Fast)
const FATAL_ERRORS = ["שגיאת שרת", "תקלה בטעינה", "Error 500", "System Unavailable", "התרחשה שגיאה", "Exception"];

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

// --- Helper Functions ---

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

// Clean up old chrome processes
try {
    const processList = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH').toString();
    if (processList.includes("chrome.exe")) {
        execSync('taskkill /F /IM chrome.exe /T');
        logger.info(">>> 🧹 Cleanup: Zombies killed.");
    }
} catch (e) {}

async function takeFullScreenshot(page, stepName) {
    try {
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
        const fileName = `FAIL_${stepName}_${timestamp}.png`;
        const filePath = path.join(screenshotsDirectory, fileName);

        const bodyHandle = await page.$('body');
        const boundingBox = await bodyHandle.boundingBox();
        const fullHeight = Math.ceil(boundingBox ? boundingBox.height : 800);

        await page.setViewport({ width: 1920, height: fullHeight });
        await page.screenshot({ path: filePath });
        await bodyHandle.dispose();
        logger.info(`>>> 🖼️ Screenshot saved: ${fileName}`);
    } catch (e) {
        logger.error(`>>> ⚠️ Screenshot failed: ${e.message}`);
    }
}

async function runStep(page, stepName, action, target) {
    logger.info(`>>> ⏳ Step Started: ${stepName}`);
    try {
        await action();
        logger.info(`>>> ✅ Step Passed: ${stepName}`);
    } catch (error) {
        logger.error(`>>> 🚩 RED FLAG at step: [${stepName}]`);
        await takeFullScreenshot(page, stepName);
        
        // שליחת מייל רק אם הכישלון הוא בשלב אימות הנתונים
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

// --- Logic Functions ---

async function handleLogin(page) {
    try {
        logger.info(">>> 🔐 Starting login flow...");

        const topLoginBtn = await page.waitForSelector(
            "xpath///button[contains(., 'כניסה') or contains(., 'התחברות')] | //a[contains(., 'כניסה') or contains(., 'התחברות')]",
            { timeout: 20000 }
        );
        await topLoginBtn.click();
        await sleep(2000);

        try {
            const passwordTab = await page.waitForSelector("xpath///button[contains(., 'באמצעות סיסמה')]", { visible: true, timeout: 5000 });
            await clickViaJS(page, passwordTab);
            await sleep(1000);
        } catch (e) {
            logger.info(">>> ℹ️ Password tab not found or already selected, proceeding...");
        }

        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 10000 });
        const tzInput = await page.waitForSelector('input[name="tz"]');
        await tzInput.type(ID, { delay: 50 });

        const passInput = await page.waitForSelector('input[name="password"]');
        await passInput.type(PASS, { delay: 50 });

        const submitBtn = await page.waitForSelector("xpath///div[contains(@class, 'MuiDialog')]//button[contains(., 'כניסה')]");
        await clickViaJS(page, submitBtn);

        logger.info(">>> ⏳ Waiting for login to complete...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            page.waitForFunction(() => !document.querySelector('.MuiDialog-container'), { timeout: 15000 }).catch(() => {})
        ]);

        logger.info(">>> ✅ Login process completed");

    } catch (e) {
        logger.error(`>>> ❌ Login Failed: ${e.message}`);
        throw e;
    }
}

// הפונקציה החדשה והמשודרגת לאימות נתונים
async function verifyDataStep(page, target) {
    logger.info(`>>> ⏳ Verifying data for ${target.name} (Expect: "${target.expectedText}")...`);
    
    // המתנה ראשונית לטעינת המבנה הבסיסי
    try {
        await page.waitForFunction(
            () => document.body.innerText.includes("נכסים") || document.body.innerText.includes("שלום"),
            { timeout: 60000 }
        );
    } catch (e) {
        logger.warn(">>> ⚠️ Dashboard structure slow to load, proceeding to strict check...");
    }

    try {
        // waitForFunction רץ בתוך הקונטקסט של הדפדפן
        await page.waitForFunction(
            (expected, errors) => {
                const bodyText = document.body.innerText;
                
                // 1. בדיקת הצלחה
                if (bodyText.includes(expected)) return true;
                
                // 2. בדיקת כישלון מהיר (Fail Fast)
                const foundError = errors.find(err => bodyText.includes(err));
                if (foundError) {
                    throw new Error(`CRITICAL_PAGE_ERROR: Found fatal text "${foundError}"`);
                }
                
                return false; // עדיין לא נטען, תמשיך לנסות
            },
            { timeout: TIMEOUT_MS, polling: 1000 }, // בדיקה כל שנייה למשך 3 דקות
            target.expectedText,
            FATAL_ERRORS
        );
        
        logger.info(`>>> ✅ SUCCESS: Data verified on ${target.name}`);

    } catch (e) {
        // ניתוח השגיאה לצורך דיווח ברור
        let failureReason = e.message;
        let pagePreview = "N/A";

        try {
            // שליפת קצת טקסט מהדף כדי להבין מה היה שם
            pagePreview = await page.evaluate(() => document.body.innerText.substring(0, 300).replace(/\n/g, ' '));
        } catch (err) {}

        if (e.message.includes("CRITICAL_PAGE_ERROR")) {
            failureReason = `⛔ Fail Fast Triggered: ${e.message.split(': ')[1]}`;
        } else if (e.message.includes("Timeout")) {
            failureReason = "⏱️ Timeout: Expected data did not appear within 3 minutes.";
        }

        throw new Error(failureReason);
    }
}

// --- Main Execution ---

(async () => {
    // Safety Kill Switch after 20 mins
    setTimeout(() => { 
        logger.error(">>> ☠️ Process stuck too long. Force killing.");
        process.exit(1); 
    }, 20 * 60 * 1000);

    logger.info(">>> 🚀 Starting RiZone QA Automation");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            // וודא שהנתיב הזה נכון במחשב שלך!
            executablePath: "C:\\Users\\itamara\\.cache\\puppeteer\\chrome\\win64-143.0.7499.169\\chrome-win64\\chrome.exe",
            args: ['--no-sandbox', '--window-size=1280,800']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        for (const target of TARGETS) {
            CURRENT_ENV = target.env;
            logger.info(`>>> 🔄 Checking ${target.name} (${CURRENT_ENV})`);

            try {
                // שלב 1: ניווט
                await runStep(page, `${target.name}__Nav`, async () => {
                    await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 60000 });
                }, target);

                // שלב 2: התחברות
                await runStep(page, `${target.name}__Login`, async () => {
                    await handleLogin(page);
                }, target);

                // שלב 3: אימות נתונים (המשודרג)
                await runStep(page, `${target.name}__Verify_Data`, async () => {
                    await verifyDataStep(page, target);
                }, target);

            } catch (e) {
                logger.warn(`>>> ⚠️ Target failed: ${e.message}`);
                // ממשיכים לסביבה הבאה גם אם הנוכחית נכשלה
            }
        }
    } catch (e) {
        logger.error(`>>> 💥 Fatal Script Error: ${e.message}`);
    } finally {
        await Promise.all(lokiPromises);
        await sleep(2000);
        if (browser) await browser.close();
        process.exit(0);
    }
})();
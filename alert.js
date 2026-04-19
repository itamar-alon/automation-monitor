require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { execSync } = require('child_process');

const SEND_EMAIL = true;
const ID = process.env.USER_ID;
const PASS = process.env.USER_PASS;
const TIMEOUT_MS = 300000; 

const FATAL_ERRORS = ["שגיאת שרת", "תקלה בטעינה", "Error 500", "System Unavailable", "התרחשה שגיאה", "Exception", "אין נתונים"];

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

let CURRENT_ENV = "system";
const lokiPromises = [];

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

function cleanPuppeteerZombies() {
    try {
        logger.info(">>> 🧹 Running Smart Cleanup...");
        const cmd = `powershell "Get-CimInstance Win32_Process -Filter 'Name = \\"chrome.exe\\"' | Where-Object { $_.CommandLine -like '*--user-data-dir=*puppeteer_dev_profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
        execSync(cmd);
        logger.info(">>> ✅ Cleanup complete.");
    } catch (e) {}
}

cleanPuppeteerZombies();

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

async function takeFullScreenshot(page, stepName) {
    try {
        const timestamp = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
        const fileName = `FAIL_${stepName}_${timestamp}.png`;
        const filePath = path.join(screenshotsDirectory, fileName);

        await page.screenshot({ path: filePath, fullPage: false }); 
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
        
        if (stepName.includes("Verify_Data") && target) {
            if (error.message.includes("אין נתונים")) {
                await sendAlertEmail(target, error.message);
            } else {
                logger.warn(`>>> 🔕 Alert Email Skipped: ${error.message}`);
            }
        }
        throw error;
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function clickViaJS(page, element) {
    await page.evaluate(el => el.click(), element);
}

async function handleLogin(page, envAuthPath) {
    try {
        logger.info(">>> 🔐 Starting login flow...");

        let needsLogin = false;
        try {
            await page.waitForSelector(
                "xpath///button[contains(., 'כניסה') or contains(., 'התחברות')] | //a[contains(., 'כניסה') or contains(., 'התחברות')]",
                { timeout: 5000 }
            );
            needsLogin = true;
        } catch (e) {
            needsLogin = false;
        }

        if (!needsLogin) {
            logger.info(">>> ✅ Session restored from cookies.");
            return;
        }

        try {
            const cookieBtn = await page.waitForSelector("xpath///button[contains(., 'מאשר הכל')]", { timeout: 3000, visible: true });
            await clickViaJS(page, cookieBtn);
            await sleep(500);
        } catch (e) {}

        let clickedPrivacyBtn = false;
        try {
            const privacyLoginBtn = await page.waitForSelector("xpath///button[contains(., 'התחברות')]", { timeout: 3000, visible: true });
            await clickViaJS(page, privacyLoginBtn);
            clickedPrivacyBtn = true;
            await sleep(1000);
        } catch (e) {}

        if (!clickedPrivacyBtn) {
            const topLoginBtn = await page.waitForSelector(
                "xpath///button[contains(., 'כניסה') or contains(., 'התחברות')] | //a[contains(., 'כניסה') or contains(., 'התחברות')]",
                { timeout: 20000 }
            );
            await topLoginBtn.click();
        }
        
        await page.waitForSelector("xpath///button[contains(., 'באמצעות סיסמה')] | input[name='tz']", { timeout: 10000 });

        try {
            const passwordTab = await page.waitForSelector("xpath///button[contains(., 'באמצעות סיסמה')]", { visible: true, timeout: 5000 });
            await clickViaJS(page, passwordTab);
            await page.waitForSelector('input[name="password"]', { visible: true, timeout: 5000 });
        } catch (e) {}

        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 10000 });
        const tzInput = await page.waitForSelector('input[name="tz"]');
        await tzInput.type(ID, { delay: 20 }); 

        const passInput = await page.waitForSelector('input[name="password"]');
        await passInput.type(PASS, { delay: 20 });

        const submitBtn = await page.waitForSelector("xpath///div[contains(@class, 'MuiDialog')]//button[contains(., 'כניסה')]");
        await clickViaJS(page, submitBtn);

        const loginOutcome = await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).then(() => 'success'),
            page.waitForFunction(() => {
                const errorElement = document.querySelector('.MuiDialog-container');
                return errorElement && (errorElement.innerText.includes('אינו מזוהה') || errorElement.innerText.includes('שגוי'));
            }, { timeout: 45000 }).then(() => 'error')
        ]).catch(e => {
            if (e.message.includes('Execution context was destroyed') || e.message.includes('Target closed')) return 'success';
            throw e;
        });

        if (loginOutcome === 'error') throw new Error("LOGIN_FAILED");

        await page.waitForFunction(() => !document.querySelector('.MuiDialog-container'), { timeout: 10000 }).catch(() => {});
        
        await sleep(1000); 
        const cookies = await page.cookies();
        fs.writeFileSync(envAuthPath, JSON.stringify(cookies));
        logger.info(`>>> 💾 Cookies saved.`);

    } catch (e) {
        logger.error(`>>> ❌ Login Failed: ${e.message}`);
        throw e;
    }
}

async function verifyDataStep(page, target) {
    logger.info(`>>> ⏳ Verifying data for ${target.name}...`);
    
    try {
        await page.waitForFunction(
            () => document.body.innerText.includes("נכסים") || document.body.innerText.includes("שלום") || document.body.innerText.includes("תשלומים"),
            { timeout: 60000 }
        );
    } catch (e) {}

    try {
        const resultHandle = await page.waitForFunction(
            (expected, errors) => {
                const bodyText = document.body.innerText || document.body.textContent || "";
                
                if (bodyText.includes(expected)) return { success: true };
                
                for (const err of errors) {
                    if (bodyText.includes(err)) {

                        if (err === "אין נתונים") continue;
                        
                        return { error: err };
                    }
                }
                return false;
            },
            { timeout: TIMEOUT_MS, polling: 2000 },
            target.expectedText,
            FATAL_ERRORS
        );
        
        const result = await resultHandle.jsonValue();
        if (result.error) throw new Error(`CRITICAL_PAGE_ERROR: ${result.error}`);
        
        logger.info(`>>> ✅ SUCCESS: ${target.name}`);

    } catch (e) {
        let failureReason = e.message;
        

        try {
            const fallbackCheck = await page.evaluate((errors) => {
                const text = document.body.innerText || document.body.textContent || "";
                for (const err of errors) {
                    if (text.includes(err)) return err;
                }
                return null;
            }, FATAL_ERRORS);
            
            if (fallbackCheck) {
                failureReason = fallbackCheck;
            } else if (e.name === 'TimeoutError' || e.message.includes('Timeout')) {
                failureReason = `לא נמצאו הנתונים המצופים (${target.expectedText}) לאחר המתנה של ${TIMEOUT_MS / 1000} שניות.`;
            }
        } catch (fallbackErr) {}
        
        throw new Error(failureReason);
    }
}

(async () => {
    setTimeout(() => { 
        logger.error(">>> ☠️ Force killing.");
        process.exit(1); 
    }, 20 * 60 * 1000);

    logger.info(">>> 🚀 Starting RiZone QA Automation");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: "C:\\Users\\itamara\\.cache\\puppeteer\\chrome\\win64-143.0.7499.169\\chrome-win64\\chrome.exe",
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--window-size=1280,800',
                '--user-data-dir=C:\\temp\\puppeteer_dev_profile' 
            ]
        });

        const page = await browser.newPage();
        
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url();

            if (['image', 'font', 'media'].includes(resourceType) || 
                url.includes('google-analytics') || 
                url.includes('facebook') || 
                url.includes('hotjar')) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.setViewport({ width: 1280, height: 800 });

        for (const target of TARGETS) {
            CURRENT_ENV = target.env;
            logger.info(`>>> 🔄 Checking ${target.name}`);
            
            const envAuthPath = path.join(__dirname, `auth_state_${target.env}.json`);

            try {
                const client = await page.target().createCDPSession();
                await client.send('Network.clearBrowserCookies'); 

                if (fs.existsSync(envAuthPath)) {
                    const cookies = JSON.parse(fs.readFileSync(envAuthPath));
                    if (cookies.length > 0) await page.setCookie(...cookies);
                }

                await runStep(page, `${target.name}__Nav`, async () => {
                    await page.goto(target.url, { waitUntil: 'networkidle2', timeout: 90000 });
                }, target);

                await runStep(page, `${target.name}__Login`, async () => {
                    await handleLogin(page, envAuthPath);
                }, target);

                await runStep(page, `${target.name}__Verify_Data`, async () => {
                    await verifyDataStep(page, target);
                }, target);

            } catch (e) {
                logger.warn(`>>> ⚠️ Target failed: ${e.message}`);
            }
        }
    } catch (e) {
        logger.error(`>>> 💥 Fatal: ${e.message}`); 
    } finally {
        if (browser) await browser.close().catch(() => {});
        await Promise.all(lokiPromises);
        await sleep(2000);
        process.exit(0);
    }
})();

Markdown
# 🚀 Muni Service Monitor


[![Node.js CI](https://img.shields.io/badge/Language-Node.js-green)](https://nodejs.org/)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-blue)](https://github.com/features/actions)
[![Monitoring](https://img.shields.io/badge/Stack-Loki%20%26%20Grafana-orange)](https://grafana.com/)


An automated monitoring and data integrity system for municipal portals. This project ensures that resident data (e.g., zip codes) remains accurate and available by simulating user flows and validating real-time dashboard data.


## 🛠 Tech Stack
- **Engine:** Node.js
- **Automation:** Puppeteer / Playwright
- **Alerting:** Courier API (Email notifications)
- **Observability:** Grafana & Loki (Logging and Monitoring)
- **Infrastructure:** Docker & GitHub Actions


## ✨ Key Features
- **Automated Resident Portal Login**: Securely navigates through the municipal authentication flow.
- **Data Integrity Validation**: Scrapes and verifies specific data fields against expected values.
- **Real-time Alerting**: Sends instant notifications via **Courier API** if discrepancies or failures are detected.
- **24/7 Monitoring**: Fully automated via **GitHub Actions** and local server deployments.
<img width="1390" height="682" alt="image" src="https://github.com/user-attachments/assets/f09d84a8-103a-406c-bb18-2ce92c1eeaf1" />


- **Log Aggregation**: Integrated with **Loki** for advanced log analysis in **Grafana**.


## 🚀 Getting Started


### 1. Installation
```bash
git clone [https://github.com/itamar-alon/automation-monitor.git](https://github.com/itamar-alon/automation-monitor.git)
cd automation-monitor
npm install


2. Environment Setup
Create a .env file in the root directory:
USER_ID=your_id
USER_PASS=your_password
COURIER_API_KEY=your_api_key
MY_EMAIL=your_e[Email Address]sage

3. Usage
Run the monitor locally:
Bash
node alert.js


Setup Loki Logging:
Bash
.\loki-windows-amd64.exe --config.file=loki-config.yaml


Run with Docker:
Bash
docker-compose up -d
🖥 Server Deployment (Internal)

For running on the organization's monitoring server:
Navigate to the network drive: pushd \\grafana\Rizone\Projects\nitur

Ensure the environment variables are configured in the system's global secrets.

🤖 GitHub Actions
The project is configured to run on a schedule. Secrets (USER_ID, COURIER_API_KEY, etc.) must be added to the repository under Settings > Secrets and variables > Actions.

📄 License
Internal project for municipal monitoring purposes.

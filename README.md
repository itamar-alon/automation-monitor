# Muni Service Monitor 🚀

Automated monitoring system for municipal portal data integrity. This script logs into the Rishon LeZion municipal website, verifies specific data (like zip codes), and sends real-time alerts if discrepancies are found.

## 🛠 Features
- **Automated Login**: Securely logs into the resident portal using Puppeteer.
- **Data Validation**: Extracts and validates specific fields from the dashboard.
- **Real-time Alerts**: Sends instant email notifications via **Courier API** if data is missing or incorrect.
- **Cloud Execution**: Configured to run 24/7 using **GitHub Actions**.

## 🚀 Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YOUR_USERNAME/muni-service-monitor.git](https://github.com/YOUR_USERNAME/muni-service-monitor.git)
   cd muni-service-monitor
Install dependencies:

Bash

npm install
Environment Variables: Create a .env file in the root directory and add the following:

קטע קוד

USER_ID=your_id
USER_PASS=your_password
COURIER_API_KEY=your_api_key
MY_EMAIL=your_email@example.com
🤖 GitHub Actions Configuration
To run this in the cloud, add the environment variables to your GitHub Repository under Settings > Secrets and variables > Actions.

📄 License
This project is for personal monitoring use.

to run the code:
pushd \\grafana\Rizone\Projects\nitur
node alert.js


to run loki setup:
.\loki-windows-amd64.exe --config.file=loki-config.yaml

to run docker:
docker-compose up -d
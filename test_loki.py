import logging
import logging_loki
import time

handler = logging_loki.LokiHandler(
    url="http://localhost:3100/loki/api/v1/push", 
    tags={"job": "test_script", "env": "dev"},
    version="1",
)

logger = logging.getLogger("my-logger")
logger.addHandler(handler)
logger.setLevel(logging.INFO)

print("Sending logs to Loki...")
logger.info("הנה לוג ראשון מהסקריפט שלי!")
logger.error("וזאת שגיאת ניסיון לגרפנה")

time.sleep(2) 
print("Done.")
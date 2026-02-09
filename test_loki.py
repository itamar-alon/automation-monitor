import logging
import logging_loki
import time

# חיבור ללוקי שרץ אצלך בשרת
handler = logging_loki.LokiHandler(
    url="http://localhost:3100/loki/api/v1/push", 
    tags={"job": "test_script", "env": "dev"},
    version="1",
)

logger = logging.getLogger("my-logger")
logger.addHandler(handler)
logger.setLevel(logging.INFO)

# שליחת לוגים
print("Sending logs to Loki...")
logger.info("הנה לוג ראשון מהסקריפט שלי!")
logger.error("וזאת שגיאת ניסיון לגרפנה")

# תוספת קריטית: נותן ל-Handler זמן לשלוח את ה-HTTP Request לפני שהסקריפט מת
time.sleep(2) 
print("Done.")
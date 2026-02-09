import logging
import logging_loki
import time

def get_loki_logger(job_name="qa_automation"):
    # הגדרת ה-Handler של Loki
    handler = logging_loki.LokiHandler(
        url="http://10.77.72.45:3100/loki/api/v1/push", 
        tags={"job": job_name, "env": "production"},
        version="1",
    )

    logger = logging.getLogger(job_name)
    
    # מוודא שלא מוסיפים את אותו Handler פעמיים אם קוראים לפונקציה שוב
    if not logger.handlers:
        logger.addHandler(handler)
        # מוסיף גם הדפסה לטרמינל הרגיל כדי שתראה מה קורה במקביל
        logger.addHandler(logging.StreamHandler())
        logger.setLevel(logging.INFO)
    
    return logger
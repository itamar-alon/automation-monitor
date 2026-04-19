import logging
import logging_loki
import time

def get_loki_logger(job_name="qa_automation"):
    handler = logging_loki.LokiHandler(
        url="http://10.77.72.45:3100/loki/api/v1/push", 
        tags={"job": job_name, "env": "production"},
        version="1",
    )

    logger = logging.getLogger(job_name)
    
    if not logger.handlers:
        logger.addHandler(handler)
        logger.addHandler(logging.StreamHandler())
        logger.setLevel(logging.INFO)
    
    return logger
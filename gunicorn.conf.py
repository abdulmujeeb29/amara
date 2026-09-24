import os

bind = "0.0.0.0:" + os.getenv("PORT", "8000")
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
threads = int(os.getenv("GUNICORN_THREADS", "4"))
timeout = 30
graceful_timeout = 30
accesslog = "-"
errorlog = "-"
# Do not put query strings (including destination labels) in access logs.
access_log_format = '%(t)s "%(m)s %(U)s" %(s)s %(b)s'

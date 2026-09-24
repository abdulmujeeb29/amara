"""Run the web process and optional database-backed worker in one small image."""
import os
import signal
import subprocess
import sys
import time

children = []
stopping = False


def stop(_signum=None, _frame=None):
    global stopping
    stopping = True
    for child in children:
        if child.poll() is None:
            child.terminate()


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
children.append(subprocess.Popen(["gunicorn", "amara.wsgi:application", "--config", "gunicorn.conf.py"]))
if os.getenv("AMARA_EVIDENCE_WORKER", "true").lower() in {"true", "1", "yes"}:
    children.append(subprocess.Popen([sys.executable, "manage.py", "evidence_worker"]))
exit_code = 0
try:
    while not stopping:
        for child in children:
            code = child.poll()
            if code is not None:
                exit_code = code or 1
                stop()
                break
        time.sleep(.5)
finally:
    stop()
    for child in children:
        try:
            child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
sys.exit(exit_code)

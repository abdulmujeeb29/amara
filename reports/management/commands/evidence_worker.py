import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from reports.evidence import claim_job, process_job


class Command(BaseCommand):
    help = "Process bounded evidence jobs. Uses PostgreSQL row locks; no extra queue service."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        while True:
            close_old_connections()
            job = claim_job()
            if job:
                process_job(job)
                self.stdout.write(f"Evidence job {job.pk} processed.")
            close_old_connections()
            if options["once"]: return
            if not job: time.sleep(1)

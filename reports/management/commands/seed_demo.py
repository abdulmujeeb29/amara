from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from reports.demo import seed_demo


class Command(BaseCommand):
    help = "Insert labelled Amara demo records without overwriting existing data."

    def handle(self, *args, **options):
        if not settings.DEMO_ENABLED:
            raise CommandError("Set AMARA_DEMO_ENABLED=True to explicitly enable demo fixtures.")
        count = seed_demo()
        self.stdout.write(self.style.SUCCESS(f"Demo seed complete: {count} records created; existing records preserved."))

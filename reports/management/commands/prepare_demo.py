from django.core.management.base import BaseCommand, CommandError

from reports.replay import prepare_demo


class Command(BaseCommand):
    help = "Prepare and save real route/AI outputs once for provider-free demo playback."

    def add_arguments(self, parser):
        parser.add_argument("--refresh", action="store_true", help="Explicitly prepare a new immutable version; old replay links remain valid.")

    def handle(self, *args, **options):
        self.stdout.write("Preparing saved replay data. Provider calls happen here, not during playback.")
        try:
            pack, created = prepare_demo(refresh=options["refresh"])
        except Exception as error:
            raise CommandError(f"Replay preparation failed ({type(error).__name__}); an existing published replay was preserved.") from None
        self.stdout.write(self.style.SUCCESS(f"{'Prepared' if created else 'Reused'} demo {pack.key}: two routes and three validated AI results."))

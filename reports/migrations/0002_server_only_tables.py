from django.db import migrations


TABLES = ("amara_incident", "amara_report", "amara_preference")


def enable_rls(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        for table in TABLES:
            schema_editor.execute(f"ALTER TABLE {schema_editor.quote_name(table)} ENABLE ROW LEVEL SECURITY")


def disable_rls(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        for table in TABLES:
            schema_editor.execute(f"ALTER TABLE {schema_editor.quote_name(table)} DISABLE ROW LEVEL SECURITY")


class Migration(migrations.Migration):
    dependencies = [("amara_reports", "0001_initial")]
    # Django connects as the table owner. Public Supabase API roles have no policy
    # granting direct access; browser preferences stay behind Django's session checks.
    operations = [migrations.RunPython(enable_rls, disable_rls)]

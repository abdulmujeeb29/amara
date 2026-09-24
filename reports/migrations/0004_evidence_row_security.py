from django.db import migrations


TABLES = ("amara_evidence_job", "amara_incident_update", "amara_update_receipt")


def enable(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        for table in TABLES:
            schema_editor.execute(f"ALTER TABLE {schema_editor.quote_name(table)} ENABLE ROW LEVEL SECURITY")


def disable(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        for table in TABLES:
            schema_editor.execute(f"ALTER TABLE {schema_editor.quote_name(table)} DISABLE ROW LEVEL SECURITY")


class Migration(migrations.Migration):
    dependencies = [("amara_reports", "0003_evidence_pipeline")]
    operations = [migrations.RunPython(enable, disable)]

from django.db import migrations


def enable(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute('ALTER TABLE "amara_prepared_demo" ENABLE ROW LEVEL SECURITY')


def disable(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute('ALTER TABLE "amara_prepared_demo" DISABLE ROW LEVEL SECURITY')


class Migration(migrations.Migration):
    dependencies = [("amara_reports", "0005_prepared_demo")]
    operations = [migrations.RunPython(enable, disable)]

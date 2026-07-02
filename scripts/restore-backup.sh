#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup.sql.gz>"
  exit 2
fi

backup_file=$1
if [ ! -f "$backup_file" ]; then
  echo "Backup not found: $backup_file"
  exit 2
fi

echo "Restoring into a disposable verification database..."
docker compose exec -T database dropdb --if-exists -U stravsteel stravsteel_restore_test
docker compose exec -T database createdb -U stravsteel stravsteel_restore_test
gzip -dc "$backup_file" | docker compose exec -T database psql \
  -v ON_ERROR_STOP=1 \
  -U stravsteel \
  -d stravsteel_restore_test
docker compose exec -T database psql \
  -v ON_ERROR_STOP=1 \
  -U stravsteel \
  -d stravsteel_restore_test \
  -c "select name, applied_at from schema_migration order by name;"
docker compose exec -T database dropdb -U stravsteel stravsteel_restore_test
echo "Restore verification succeeded; the disposable database was removed."

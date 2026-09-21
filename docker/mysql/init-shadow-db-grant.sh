#!/bin/bash
# Runs once, when the MySQL data volume is first created
# (docker-entrypoint-initdb.d). To re-run: docker compose down -v && docker compose up -d
#
# `prisma migrate dev` creates a throw-away "shadow" database named
# prisma_migrate_shadow_db_<uuid> to check for schema drift, then drops it.
# The app user gets that privilege on exactly that name pattern and nothing
# else, so it never needs to be root. Only dev machines run `migrate dev`;
# `migrate deploy` on real environments does not need a shadow database.
#
# A .sh (not .sql) so MYSQL_USER from .env can be used. `\_` escapes the
# underscore, which is otherwise a single-character wildcard in MySQL grants.
set -euo pipefail

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
GRANT ALL PRIVILEGES ON \`prisma\\_migrate\\_shadow\\_db%\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL

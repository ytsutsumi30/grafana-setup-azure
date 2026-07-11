FROM postgres:17-alpine

COPY init/*.sql /docker-entrypoint-initdb.d/
COPY migrations/*.sql /docker-entrypoint-initdb.d/migrations/

FROM mysql:8.4
COPY init/ /docker-entrypoint-initdb.d/
CMD ["mysqld", "--bind-address=0.0.0.0", "--datadir=/var/lib/mysql/data", "--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]

SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'db_cacsms-trader' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "db_cacsms-trader";
CREATE DATABASE "db_cacsms-trader";

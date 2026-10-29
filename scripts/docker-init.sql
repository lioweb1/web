-- Development-only credentials (match .env.example). Never use these in production.
CREATE ROLE leadorbit_owner LOGIN CREATEROLE PASSWORD 'owner_dev';
CREATE ROLE leadorbit_app LOGIN PASSWORD 'app_dev';
CREATE DATABASE leadorbit OWNER leadorbit_owner;
CREATE DATABASE leadorbit_test OWNER leadorbit_owner;
-- The tenant group role is created by the first migration; pre-create it so the grant works now.
CREATE ROLE leadorbit_tenant NOLOGIN;
GRANT leadorbit_tenant TO leadorbit_app;

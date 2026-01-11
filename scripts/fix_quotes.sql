PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS quotes;

CREATE TABLE quotes (
  symbol      TEXT PRIMARY KEY,
  price       REAL NOT NULL,
  bid         REAL,
  ask         REAL,
  updated_at  TEXT NOT NULL
);
PRAGMA foreign_keys = ON;
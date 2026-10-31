CREATE TABLE login_throttle (
  username TEXT PRIMARY KEY NOT NULL,
  failures INTEGER NOT NULL CHECK (failures > 0),
  window_until INTEGER NOT NULL
)

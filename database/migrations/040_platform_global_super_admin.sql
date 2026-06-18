ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS is_system_protected BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_users_username_lower
  ON platform_users (LOWER(username))
  WHERE username IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_system_platform_users()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_system_protected THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'System-protected user cannot be deleted';
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.is_system_protected := true;
      NEW.role := 'super_admin';
      IF NEW.status IS DISTINCT FROM 'active' THEN
        NEW.status := 'active';
      END IF;
      NEW.username := OLD.username;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_system_platform_users ON platform_users;
CREATE TRIGGER trg_protect_system_platform_users
  BEFORE UPDATE OR DELETE ON platform_users
  FOR EACH ROW
  EXECUTE FUNCTION protect_system_platform_users();

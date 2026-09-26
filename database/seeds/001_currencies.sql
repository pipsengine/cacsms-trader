-- Seed currencies (ISO-extensible)
INSERT OR IGNORE INTO currencies(code, name, kind) VALUES
('USD','US Dollar','FIAT'),
('EUR','Euro','FIAT'),
('GBP','British Pound','FIAT'),
('JPY','Japanese Yen','FIAT'),
('CHF','Swiss Franc','FIAT'),
('CAD','Canadian Dollar','FIAT'),
('AUD','Australian Dollar','FIAT'),
('NZD','New Zealand Dollar','FIAT'),
('XAU','Gold','METAL'),
('NGN','Nigerian Naira','FIAT');

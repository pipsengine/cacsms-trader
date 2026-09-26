-- System defaults (no secrets)
INSERT OR IGNORE INTO system_settings(key, value, value_type, description) VALUES
('app.name','Cacsms Trader','string','Product name'),
('app.version','2.0.0','string','Application version'),
('app.mode','SIMULATION','string','SIMULATION|PAPER|LIVE'),
('safety.stale_signal_protection','true','boolean','Block stale upstream signals'),
('safety.require_risk_approval','true','boolean','Require risk gate before Stage 9'),
('safety.max_concurrent_positions','3','number','Global concurrent position soft limit'),
('safety.default_risk_pct','0.5','number','Default risk per trade percent'),
('safety.daily_loss_limit_pct','2.5','number','Daily loss soft limit'),
('mt5.credential_storage','secret_ref','string','Credentials must use secret references only'),
('db.schema_version','1','number','Current schema version');

INSERT OR IGNORE INTO users(id, email, display_name, role, status, password_hash_ref) VALUES
('user-admin','admin@cacsms.local','Cacsms Admin','admin','active','secret://users/admin/password_hash');

INSERT OR IGNORE INTO prop_profiles(id, name, firm_name, currency, notes) VALUES
('prop-default','Default Prop 100K','Example Prop Firm','USD','Configurable template — adjust per firm');

INSERT OR IGNORE INTO prop_rules(profile_id, phase, account_size, daily_loss_limit_pct, max_loss_limit_pct, profit_target_pct, min_trading_days, news_trading, weekend_holding, overnight_holding, max_exposure_pct, consistency_rule_pct)
VALUES ('prop-default','FUNDED',100000,5,10,8,5,0,0,1,1,30);

INSERT OR IGNORE INTO mt5_nodes(id, name, host, status, version) VALUES
('node-local','Local Bridge Node','127.0.0.1','CONNECTED','1.0.0');

INSERT OR IGNORE INTO mt5_terminals(id, node_id, path_ref, status) VALUES
('CACSMS-MT5-0001','node-local','secret://terminals/CACSMS-MT5-0001/path','DISCONNECTED'),
('CACSMS-MT5-0002','node-local','secret://terminals/CACSMS-MT5-0002/path','DISCONNECTED'),
('CACSMS-MT5-0003','node-local','secret://terminals/CACSMS-MT5-0003/path','DISCONNECTED'),
('CACSMS-MT5-0004','node-local','secret://terminals/CACSMS-MT5-0004/path','DISCONNECTED');

// Create or reset an owner account from the server shell:
//   node scripts/reset-admin.js email@example.com "New-Strong-Password"
'use strict';
const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 10) { console.error('Usage: node scripts/reset-admin.js <email> <password (min 10 chars)>'); process.exit(1); }
const { get, run } = require('../src/db');
const { hashPassword } = require('../src/auth');
const a = get('SELECT id FROM admins WHERE email = ?', email);
if (a) run("UPDATE admins SET password_hash = ?, active = 1, role = 'owner', token_version = token_version + 1 WHERE id = ?", hashPassword(password), a.id);
else run("INSERT INTO admins(name, email, password_hash, role) VALUES('مدير المتجر', ?, ?, 'owner')", email.toLowerCase(), hashPassword(password));
console.log(`✓ Owner account ${a ? 'reset' : 'created'}: ${email}`);

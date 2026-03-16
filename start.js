// start.js - Runs both WhatsApp and Telegram bots simultaneously
const { spawn } = require('child_process');

console.log('🚀 Starting both bots...');

// Run WhatsApp bot (index.js)
const whatsapp = spawn('node', ['index.js'], { 
  stdio: 'inherit',
  env: { ...process.env, BOT_TYPE: 'whatsapp' }
});
console.log('✅ WhatsApp bot started (index.js)');

// Run Telegram bot (bot.js)
const telegram = spawn('node', ['bot.js'], { 
  stdio: 'inherit',
  env: { ...process.env, BOT_TYPE: 'telegram' }
});
console.log('✅ Telegram bot started (bot.js)');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down both bots...');
  whatsapp.kill();
  telegram.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down both bots...');
  whatsapp.kill();
  telegram.kill();
  process.exit();
});
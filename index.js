import { startBot } from './whatsapp.js';
import { config } from './config.js';

console.log('----------------------------------------------------');
console.log('🤖 Starting Gemini WhatsApp Assistant Bot');
console.log(`📁 Database Path: ${config.dbPath}`);
console.log(`🔑 Auth Directory: ${config.authDir}`);
console.log(`⏱️  Session Timeout: ${config.sessionTimeoutMs / 60000} minutes`);
console.log(`⚡ Max Concurrent Gemini Calls: ${config.maxConcurrentGeminiCalls}`);
console.log('----------------------------------------------------\n');

startBot().catch((err) => {
  console.error('Fatal error starting WhatsApp bot:', err);
  process.exit(1);
});

// Handle graceful shutdown
function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

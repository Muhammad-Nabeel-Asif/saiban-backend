// Load environment variables from .env file
require('dotenv').config();

module.exports = {
  apps: [
    // PRODUCTION - Stable version for client/frontend
    {
      name: 'saiban-production',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        // Use MONGODB_URI (what app.module.ts expects)
        MONGODB_URI: process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || 'mongodb://localhost:27017/saiban-prod',
        JWT_SECRET: process.env.JWT_SECRET,
        CORS_ORIGINS: process.env.CORS_ORIGINS,
        FORCE_COLOR: '0',
      },
      // Logging configuration
      error_file: 'logs/production-error.log',
      out_file: 'logs/production-out.log',
      log_file: 'logs/production-combined.log',
      merge_logs: true,
      combine_logs: true,

      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',

      kill_timeout: 10000,
      listen_timeout: 15000,
      wait_ready: true,
    },

    // STAGING - Testing version for development
    {
      name: 'saiban-staging',
      script: 'dist/main.js',
      instances: 1, // Keep staging simple, but use reload-safe startup behavior
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'staging',
        PORT: 4001, // Different port
        // Use MONGODB_URI (what app.module.ts expects)
        MONGODB_URI: process.env.MONGODB_URI_STAGING || 'mongodb://localhost:27017/saiban-staging',
        JWT_SECRET: process.env.JWT_SECRET,
        CORS_ORIGINS: process.env.CORS_ORIGINS,
        FORCE_COLOR: '0',
      },
      // Separate logs for staging
      error_file: 'logs/staging-error.log',
      out_file: 'logs/staging-out.log',
      log_file: 'logs/staging-combined.log',
      merge_logs: true,
      combine_logs: true,

      max_memory_restart: '500M',
      autorestart: true,
      watch: false, // Set to true if you want auto-reload on file changes
      max_restarts: 10,
      min_uptime: '10s',

      kill_timeout: 10000,
      listen_timeout: 15000,
      wait_ready: true,
    },
  ],
};

module.exports = {
  apps: [
    {
      name: 'saiban-backend',
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // Force logs to flush immediately
        FORCE_COLOR: '0',
      },
      // Logging configuration
      error_file: 'logs/saiban-backend-error.log',
      out_file: 'logs/saiban-backend-out.log',
      log_file: 'logs/saiban-backend-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // IMPORTANT: Set to false to see logs in real-time
      combine_logs: true,

      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',

      // Kill and listen timeouts
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};

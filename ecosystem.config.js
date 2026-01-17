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
        NO_COLOR: '1',
      },
      error_file: 'logs/saiban-backend-error.log',
      out_file: 'logs/saiban-backend-out.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: '10s',
      merge_logs: true,
    },
  ],
};

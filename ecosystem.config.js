module.exports = {
  apps: [{
    name:         'forgerift-payments',
    script:       'src/index.js',
    instances:    1,
    exec_mode:    'fork',
    autorestart:  true,
    watch:        false,
    max_memory_restart: '128M',
    env: {
      NODE_ENV: 'production',
      PORT:     3020,
    },
    // Explicit paths inside PM2_LOG_DIR (/root/.pm2/logs/) so vps-control-mcp can
    // read them via get_recent_errors / get_recent_output without extra config.
    // Without these, PM2 appends the process ID (-4, -5...) to filenames, making
    // them unpredictable across restarts.
    error_file: '/root/.pm2/logs/forgerift-payments-error.log',
    out_file:   '/root/.pm2/logs/forgerift-payments-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

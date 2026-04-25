module.exports = {
  apps: [{
    name:         'forgerift-payments',
    script:       'src/index.js',
    instances:    1,
    autorestart:  true,
    watch:        false,
    max_memory_restart: '128M',
    env: {
      NODE_ENV: 'production',
      PORT:     3020,
    },
    // Logs go to PM2 default paths (/root/.pm2/logs/forgerift-payments-{out,error}.log)
    // so vps-control-mcp can read them via get_recent_errors / get_recent_output
    // without needing EXTRA_READ_DIRS configuration.
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

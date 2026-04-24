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
    error_file: 'logs/payments-err.log',
    out_file:   'logs/payments-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};

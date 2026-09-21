module.exports = {
  apps: [{
    name: 'tencent-meeting-booking',
    script: 'backend/server.js',
    cwd: __dirname + '/..',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production'
    }
  }]
};

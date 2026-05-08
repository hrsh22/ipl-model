const path = require('node:path')

const appRoot = __dirname
const pythonPath = [
  path.join(appRoot, 'venv', 'bin'),
  path.join(appRoot, '.venv', 'bin'),
  process.env.PATH || '',
]
  .filter(Boolean)
  .join(':')

module.exports = {
  apps: [
    {
      name: 'ipl-model-api',
      cwd: appRoot,
      script: 'dist/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '1G',
      time: true,
      out_file: 'logs/api.out.log',
      error_file: 'logs/api.err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PATH: pythonPath,
      },
    },
    {
      name: 'ipl-model-daily-refresh',
      cwd: appRoot,
      script: 'pnpm',
      args: 'model:daily-refresh',
      interpreter: 'none',
      exec_mode: 'fork',
      watch: false,
      autorestart: false,
      cron_restart: '0 4 * * *',
      time: true,
      out_file: 'logs/daily-refresh.out.log',
      error_file: 'logs/daily-refresh.err.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        PATH: pythonPath,
      },
    },
  ],
}

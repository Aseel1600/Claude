module.exports = {
  apps: [
    {
      name: "omniroute",
      script: "npm",
      args: "run start",
      cwd: "/Users/work/hermes-sandbox/Hermes_Omni",
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      restart_delay: 5000,
      max_memory_restart: "700M",
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
      merge_logs: true,
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "omniroute-tunnel",
      script: "npm",
      args: "run tunnel",
      cwd: "/Users/work/hermes-sandbox/Hermes_Omni",
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      restart_delay: 5000,
      max_memory_restart: "500M",
      time: true,
      merge_logs: true
    },
    {
      name: "hermes-tg-bot",
      script: "/Users/work/hermes-sandbox/Hermes_Omni/scripts/serpentos_logic/tg-bot.cjs",
      cwd: "/Users/work/hermes-sandbox/Hermes_Omni",
      autorestart: true,
      watch: false,
      min_uptime: "10s",
      max_restarts: 10,
      exp_backoff_restart_delay: 500,
      restart_delay: 5000,
      max_memory_restart: "500M",
      kill_timeout: 10000,
      time: true,
      merge_logs: true,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};

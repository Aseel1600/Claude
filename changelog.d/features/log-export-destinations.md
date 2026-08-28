- **feat(dashboard):** continuously export call logs to external analytics stores. A pluggable
  destination registry ships the full Logs-tab record set on an hourly `JobRegistry` cron, with
  a persisted per-destination cursor, batched inserts, a config UI rendered from each
  destination's own field descriptors, and a REST layer (`/api/log-export/*`) for CRUD, a
  connection test, and an on-demand run. Google BigQuery is the first destination, using a
  service-account key stored encrypted at rest and streaming inserts keyed by call-log id.

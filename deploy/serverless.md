# Serverless target (Cloud Run + Cloud Scheduler)

1. `gcloud run deploy growthloop --source . --region asia-south1 --no-allow-unauthenticated --set-env-vars GROWTHLOOP_NO_LOOP=1`
   (put keys in Secret Manager and mount them as env vars).
2. Mount persistent storage for `/data` (Cloud Run volume on Cloud Storage FUSE / Filestore), or move the
   store and checkpointer to Postgres (planned: `GROWTHLOOP_DB_URL`).
3. Cloud Scheduler job every 15 min: `POST https://<service>/api/tick` with an OIDC token. The tick does what
   the in-process loop thread does locally (metrics sync, daily/weekly cycles, resume after approvals).
4. Set Cloud Run max instances to 1 so only one cycle runs at a time.

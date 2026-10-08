<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## better-craft platform conventions

This app runs on the shared better-craft platform (platform-utilities EKS cluster, account
`227843491785`). Follow these conventions in addition to the Next.js rules above.

### Credentials — what the AI agent does vs. what a human does

**The agent (Jarvis/Claude/etc.) implements the wiring, never creates or types the actual secret
value.** A human with AWS SSO access is the one who puts the real credential into SSM Parameter
Store. Concretely:

- **Agent's job:** add a `secretKey`/`remoteRef` entry to `externalSecret.data` in
  `k8s/APP_NAME/values.yaml` pointing at the SSM path where the value will live, and reference
  the resulting env var name in application code (`process.env.YOUR_VAR`). That's it — the agent
  never has AWS credentials to actually write to SSM, and must never invent, generate, or
  hardcode a placeholder value that looks like a real secret.
- **Human's job:** using their own AWS SSO session, run
  `aws ssm put-parameter --name /better-craft/<app-suffix>/<environment>/<key> --type SecureString --value '<real-value>'`
  (or the AWS Console) to actually populate the parameter. The agent cannot do this step — it has
  no AWS credentials into account `227843491785` for this purpose.
- If a task says "add support for X API key," the agent's deliverable is the `values.yaml`
  wiring + code that reads the env var, plus a note in the PR telling the human exactly which SSM
  path needs the real value populated before the ExternalSecret will sync successfully.

### Other conventions

- **Port:** the app must listen on **port 3000** — this is hardcoded into the Helm chart
  (`k8s/APP_NAME/values.yaml` `service.port` / `templates/deployment.yaml` `containerPort`) and
  the shared better-craft ALB's target-group assumptions. Do not change it without also updating
  the chart and clearing it with platform/DevOps first.
- **SSM path convention:** `/better-craft/<app-suffix>/<environment>/*`, where `<app-suffix>` is
  this repo's name with the `better-craft-` prefix stripped (matches the ECR registry path and
  the IRSA trust policy's `sub` claim already scoped to this app).
- **Kubernetes secret consumption:** the chart's `ExternalSecret`/`SecretStore` templates sync SSM
  values into a Kubernetes `Secret`, consumed by the Deployment via `envFrom.secretRef` — never
  read SSM directly from application code, never inline plaintext secret values in `values.yaml`
  or any chart template.
- **IAM / IRSA:** this app's IAM permissions (currently: SSM read scoped to its own path) are
  defined in `terraform-bc`'s shared better-craft project
  (`Project/better-craft/227843491785/eu-west-1/shared/main.tf`), not in this repo. A new AWS
  permission is a `terraform-bc` PR, not a chart change.
- **Namespace:** deploys into the shared `better-craft` Kubernetes namespace (every better-craft
  app shares one namespace) — don't add namespace-creation logic to this chart.

### PostgreSQL — when the app needs a persistent database

If the app requires PostgreSQL, provision it as a StatefulSet-backed database
**inside this chart**, following the pattern established in
`better-craft-betting-arena` (terraform-bc PR #376, chart PR merged 2026-09-10).
Do not use RDS for better-craft apps — the platform runs per-app Postgres in-cluster.

- **Chart dependency:** add the vendored `groundhog2k/postgres` Helm chart as a
  dependency in `Chart.yaml`, aliased to `postgresql`:
  ```yaml
  dependencies:
    - name: postgres
      alias: postgresql
      version: "1.6.8"
      repository: https://groundhog2k.github.io/helm-charts/
  ```
  Pin to chart version **1.6.8** (appVersion **18.6**, PostgreSQL major version 18) for
  any new app. Run `helm dependency update k8s/APP_NAME/` to regenerate `Chart.lock`
  after adding it.
- **StatefulSet, not Deployment:** the chart's `useDeployment: false` setting is what
  makes `groundhog2k/postgres` render a StatefulSet with a PVC instead of a stateless
  Deployment — never flip this to `true` for a database workload.
- **Minimal `postgresql:` block in `values.yaml`:**
  ```yaml
  postgresql:
    fullnameOverride: APP_NAME-postgresql
    image:
      tag: "18.6"
    useDeployment: false
    customAnnotations:
      argocd.argoproj.io/sync-wave: "1"
    customLabels:
      project: better-craft
      app.kubernetes.io/part-of: better-craft
      app.kubernetes.io/business-unit: <business-unit>
    serviceAccount:
      create: true
    service:
      type: ClusterIP
      port: 5432
    settings:
      existingSecret: APP_NAME-env-postgresql
      superuserPassword:
        secretKey: POSTGRES_PASSWORD
      authMethod: scram-sha-256
    userDatabase:
      existingSecret: APP_NAME-env-postgresql
      name:
        secretKey: POSTGRES_DB
      user:
        secretKey: USERDB_USER
      password:
        secretKey: USERDB_PASSWORD
    storage:
      requestedSize: 20Gi   # size to the app's actual need; 20Gi is the betting-arena default, not a mandatory floor
      className: auto-ebs-gp3
      accessModes: [ReadWriteOnce]
      persistentVolumeClaimRetentionPolicy:
        whenDeleted: Retain
        whenScaled: Retain
    resources:
      requests: { cpu: 250m, memory: 512Mi }
      limits: { cpu: "1", memory: 1Gi }
    initResources:
      requests: { cpu: 50m, memory: 64Mi }
      limits: { cpu: 250m, memory: 128Mi }
    # NetworkPolicy resources are not permitted by this deployment platform.
    networkPolicy: {}

  database:
    name: <app-database-name>
    username: <app-database-username>   # a dedicated application user, NOT postgres/superuser
  ```
  `database.name`/`database.username` are identifiers, not credentials — the chart's
  `ExternalSecret` template builds `DATABASE_URL` from them plus `databasePassword`. The
  app's runtime connects as this dedicated application user; only the ArgoCD-managed
  superuser password (`postgres-admin-password`) has superuser rights, and application
  code must never use it.
- **Separate application user, never the superuser:** the chart provisions two distinct
  passwords — `postgresPassword` (superuser, `authMethod: scram-sha-256`) and
  `databasePassword` (the app's own least-privilege user via `userDatabase`). Application
  workloads (web/worker) connect with the application user's `DATABASE_URL`; only
  ArgoCD/migration jobs are expected to ever need superuser access, and even the
  migration Job in this pattern uses the app user's `DATABASE_URL`, not the superuser.
- **Credentials in SSM Parameter Store, never inline:** add the database passwords to
  `externalSecret.data` the same way as any other secret (see the "Credentials" section
  above) — the human populates the real values, the agent only wires the `remoteRef`:
  ```yaml
  externalSecret:
    data:
      web:
        - secretKey: databasePassword
          remoteRef:
            key: /better-craft/<app-suffix>/production/database-password
      postgresql:
        - secretKey: postgresPassword
          remoteRef:
            key: /better-craft/<app-suffix>/production/postgres-admin-password
        - secretKey: databasePassword
          remoteRef:
            key: /better-craft/<app-suffix>/production/database-password
  ```
  The `postgresql` role's `ExternalSecret` renders into the k8s Secret named
  `<existingSecret>` above (`APP_NAME-env-postgresql`) that `settings.existingSecret` /
  `userDatabase.existingSecret` reference — the StatefulSet's chart reads the superuser
  and application-user passwords from that Secret, never from `values.yaml` directly.
- **ArgoCD sync-wave ordering:** the database (`SecretStore` at wave `-1`, `ExternalSecret`s
  at wave `0`, Postgres StatefulSet at wave `1`) must come up before the app's Deployment
  (wave `3`) and any migration Job (wave `2`, gated by a `wait-for-database` init container
  that polls `psql ... SELECT 1` against the app's own `DATABASE_URL`). Set
  `customAnnotations: {argocd.argoproj.io/sync-wave: "1"}` on the `postgresql:` block so
  ArgoCD provisions it ahead of dependent resources; without explicit sync-waves ArgoCD
  applies everything in one wave and the app pod can race the database on first deploy.

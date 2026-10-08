# better-craft TypeScript app template

Template repository for `better-craft` applications. Create a repo from this template,
rename the placeholders, push, and the app builds to ECR and deploys to the shared
`better-craft` namespace on the `platform-utilities` EKS cluster with TLS and DNS
already handled.

This repo contains **no application code** — that's yours. What it gives you is the
Dockerfile, the CI/CD workflow, and the Helm chart ArgoCD picks up.

## Requirements on the app

| Requirement | Why |
|---|---|
| Listens on port **3000** | Hardcoded in the Dockerfile, Service, Deployment and Ingress backend |
| Exposes **`GET /healthz`** returning 2xx | Docker `HEALTHCHECK`, k8s liveness + readiness probes, and the ALB target-group health check all point at it |
| `package.json` with `build` and `start` scripts, build output in `dist/`, entrypoint `dist/index.js` | Assumed by the Dockerfile |

If the app uses a different health path, change it in **two** places — `HEALTHCHECK` in
[Dockerfile](Dockerfile) and `healthPath` in [k8s/APP_NAME/values.yaml](k8s/APP_NAME/values.yaml)
(which feeds both probes and the ALB annotation). Do not leave a probe aimed at a route
that does not exist.

## Rename checklist — do this first, every time

`APP_NAME` must be replaced with the **exact GitHub repo name** in all five places.
The ArgoCD ApplicationSet templates the chart path as `k8s/{{repository}}`, so a folder
name that doesn't match the repo name produces an Application pointing at a path that
doesn't exist, and it never syncs.

```bash
APP=my-app   # must equal the repo name, i.e. better-craft-my-app -> use better-craft-my-app
git mv k8s/APP_NAME "k8s/$APP"
grep -rl APP_NAME . --exclude-dir=.git | xargs sed -i '' "s/APP_NAME/$APP/g"
```

| File | Placeholder |
|---|---|
| `k8s/APP_NAME/` | folder name |
| `k8s/<app>/Chart.yaml` | `name:` — drives every rendered resource name |
| `k8s/<app>/values.yaml` | `image.repository` and `ingress.host` |
| `.github/workflows/build-and-push.yml` | the `APP_NAME` env var (used everywhere else in the file) |

Two values still need pasting after the platform Terraform is applied:

- `ingress.securityGroupId` — the `better_craft_alb_security_group_id` output of the
  `eu-west-1-shared-platform-utilities` workspace. Without it the AWS Load Balancer
  Controller attaches a managed security group open to `0.0.0.0/0` and the shared ALB
  stops being office/VPN-only.
- `serviceAccount.roleArn` — only if this app has its own AWS resources (see below).

`role-to-assume` is **not** a placeholder. `BetterCraftGHARole` is one shared role trusted
by every `repo:BetterCollective/better-craft-*` on `main` and tags, so its ARN is the same
in every app repo. The workflow reads it from `secrets.AWS_BETTER_CRAFT_ROLE_TO_ASSUME` —
set that as an **organisation** secret once and repos created from this template inherit it.

## The build pipeline

`.github/workflows/build-and-push.yml` runs on pushes to `main` and on any tag, and does
four things in order:

1. **Verify the app** — `npm ci`, then `npm run lint --if-present`, `npm run build`,
   `npm run test --if-present`. Add real `lint`/`test` scripts to `package.json` and they
   gate the image automatically. If `package.json` still has the `npm init` default test
   stub (`exit 1`), delete it or replace it — it will fail the build.
2. **Verify the chart** — `helm lint` and `helm template` against both values files, the
   same way ArgoCD renders it. An incomplete `APP_NAME` rename fails here instead of
   turning into a broken sync.
3. **Build and push** — Buildx with a GitHub Actions layer cache, `linux/amd64`, pushed to
   ECR under two tags: the short commit SHA (or the git tag name, for tag builds) and
   `latest`.
4. **Pin the tag** — rewrites `k8s/<app>/values_image_tag.yaml` with the resolved tag and
   commits it to `main`. **This commit is the deploy.** ArgoCD only redeploys when git
   changes, so a chart pinned at `latest` would never resync; the tag commit is what makes
   the rollout happen. Tag builds commit onto `main` too.

Consequences worth knowing:

- The trigger has `paths-ignore: ['k8s/**']`, so the pipeline's own commit does not
  re-trigger it. It also means a chart-only edit does not rebuild the image — ArgoCD picks
  that up from git on its own.
- The push uses the default `GITHUB_TOKEN`. If `main` is protected, allow that actor to
  push or the deploy step fails after the image is already in ECR.
- Runs are serialised with a `concurrency` group, since every run ends in a push to `main`.
- Never hand-edit `values_image_tag.yaml`; CI overwrites it.

## Onboarding a new app

1. Create the repo from this template. **The name must start with `better-craft-`** —
   that prefix is what the ArgoCD ApplicationSet matches on.
2. Run the rename above.
3. In `terraform-bc`, add one entry to `local.ecr_repositories` in
   `Project/better-craft/227843491785/eu-west-1/shared/locals.tf`:
   ```hcl
   my-app = { registry_name = "better-craft/my-app/production", retention_days = 7 }
   ```
   PR, merge, apply. No IAM change — the role and its ECR push policy already cover
   `better-craft/*`.
4. Push to `main` or push a tag. CI assumes `BetterCraftGHARole` via OIDC, pushes to
   `<registry>/better-craft/my-app/production:<sha-or-tag>`, then commits the tag into
   `k8s/my-app/values_image_tag.yaml` — which is what triggers the ArgoCD rollout.
5. Set `ingress.enabled: true` when the app should be reachable.
6. Wait for discovery. ArgoCD is not exposed publicly, so GitHub cannot deliver a
   webhook — the SCM Provider generator polls. A new repo becomes an Application within
   the poll interval (a few minutes by default), not instantly.

The hostname `<app>.better-craft.bettercollective.dev` needs no certificate and no DNS
record of its own: one wildcard ACM cert is attached at the IngressClassParams level and
one wildcard Route53 alias points at the shared ALB.

## Per-app AWS resources (most apps: skip this)

Only if the app needs its own S3 bucket, RDS instance, extra Parameter Store access, etc.
Give it its own folder in `terraform-bc`:
`Project/better-craft-<app-name>/227843491785/eu-west-1/production/`.

Set `serviceAccount.create: true` in `values.yaml` and paste the role ARN into
`serviceAccount.roleArn`. The ServiceAccount is rendered as `.Chart.Name`, so the trust
condition below must use that exact name in the shared `better-craft` namespace —
otherwise the IRSA trust never matches and the pod gets no AWS access.

```hcl
module "s3_bucket" {
  source      = "otf.bettercollective.rocks/bettercollective/s3/bc"
  version     = "2.1.0"
  bucket_name = "better-craft-<app-name>-production"
  tags        = local.default_tags
}

module "eks_service_role" {
  source  = "otf.bettercollective.rocks/bettercollective/iam-role/bc"
  version = "1.2.2"

  role_name = "PlatformUtilitiesEKSBetterCraft${title("<app-name>")}ServiceRole"
  purpose   = "custom"

  custom_assume_role_schema = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EKSOIDCAssumeRole"
      Effect    = "Allow"
      Principal = { Federated = data.terraform_remote_state.platform_utilities.outputs.eks_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${data.terraform_remote_state.platform_utilities.outputs.eks_oidc_provider_name}:sub" = "system:serviceaccount:better-craft:<app-name>"
          "${data.terraform_remote_state.platform_utilities.outputs.eks_oidc_provider_name}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  inline_policies = [ /* only what this app's pod actually needs, scoped to its own resource ARNs */ ]
  tags            = local.default_tags
}
```

`data.terraform_remote_state.platform_utilities` reads the
`eu-west-1-shared-platform-utilities` workspace in the `ai-content` OTF org — copy the
`data.tf` from `Project/video-infographics-tool/227843491785/eu-west-1/production/`.

## Verifying a new app

```bash
# renders, labels present, image path matches Terraform — same files ArgoCD uses
helm template <app> k8s/<app> -f k8s/<app>/values.yaml -f k8s/<app>/values_image_tag.yaml
docker build -t <app> . && docker run --rm -p 3000:3000 <app>
curl -f http://localhost:3000/healthz  # must be 2xx before probes are wired to it
dig <app>.better-craft.bettercollective.dev
curl -v https://<app>.better-craft.bettercollective.dev/healthz  # clean TLS, no cert warning
```

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

Template repository for `better-craft` applications. Create a repo from this template,
rename the placeholders, push, and the app builds to ECR and deploys to the shared
`better-craft` namespace on the `platform-utilities` EKS cluster with TLS and DNS already
handled.

The scaffold is a Next.js app (App Router, Tailwind, pnpm) serving Hello World on port
3000. Replace it with the real app; keep the two platform contracts below.

Infrastructure documentation lives in `terraform-bc` under
[`Project/better-craft/README.md`](https://github.com/BetterCollective/terraform-bc/blob/main/Project/better-craft/README.md).

## Platform contracts

| Requirement | Why |
|---|---|
| Listens on port **3000** | Hardcoded in the Dockerfile, Service, Deployment and Ingress backend |
| Serves **`GET /healthz`** with 2xx | Docker `HEALTHCHECK`, the k8s liveness + readiness probes, and the ALB target-group health check all point at it |
| `next.config.ts` keeps `output: "standalone"` | The Dockerfile's runtime stage copies `.next/standalone` and runs `node server.js` with no install of its own |

`app/healthz/route.ts` implements the health endpoint. To move it, change `healthPath` in
`k8s/APP_NAME/values.yaml` (which feeds both probes and the ALB annotation) and the
`HEALTHCHECK` in the Dockerfile. Never leave a probe aimed at a route that does not exist.

## Local development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm run build    # produces .next/standalone
```

## Two names, and which is which

Everything downstream keys off one of these. Getting them the wrong way round is the most
common way to break a new app.

| | Value for repo `better-craft-rafalb-app3` | Used for |
|---|---|---|
| **Full repo name** | `better-craft-rafalb-app3` | the `k8s/<...>` chart folder, and the ArgoCD Application name |
| **Short name** (prefix stripped) | `rafalb-app3` | `Chart.yaml` `name:` — so every rendered resource, the ServiceAccount and the IRSA subject — plus the ECR path and the hostname |

The folder has to be the full repo name because the ApplicationSet renders
`path: k8s/{{repository}}`; a mismatch produces an Application pointing at a path that does
not exist, and it never syncs. Everything else is short, which is why the ECR path is
`better-craft/rafalb-app3/production` and not `better-craft/better-craft-rafalb-app3/production`.
Helm does not require `Chart.yaml` `name:` to match the directory, so this split is legal.

## Rename checklist — do this first, every time

```bash
APP=better-craft-my-app        # must equal the repo name
SHORT=${APP#better-craft-}     # my-app
git mv k8s/APP_NAME "k8s/$APP"
grep -rl SHORT_NAME "k8s/$APP" | xargs perl -pi -e "s/SHORT_NAME/$SHORT/g"
```

That is the whole rename. `APP_NAME` is only ever a directory name — no file inside the
chart contains it — and the workflow derives both names from `GITHUB_REPOSITORY`, so it has
no placeholder at all.

Scoping the replace to the chart folder is deliberate: a repo-wide replace would rewrite the
literal `k8s/APP_NAME` inside the workflow's guard job, which would then skip every build
forever. `perl -pi -e` rather than `sed -i` because `sed` needs `-i ''` on macOS and bare
`-i` on Linux.

| File | Placeholder |
|---|---|
| `k8s/APP_NAME/` | folder name → full repo name |
| `k8s/<app>/Chart.yaml` | `name:` → short name |
| `k8s/<app>/values.yaml` | `image.repository` and `ingress.host` → short name |
| `.github/workflows/build-and-push.yml` | nothing |

The guard job re-derives the ECR path and checks `image.repository` in `values.yaml` ends
with it, so a chart and a build that disagree fail before anything is pushed.

Two values still need pasting after the platform Terraform is applied:

- `ingress.securityGroupId` — the `better_craft_alb_security_group_id` output of the
  `eu-west-1-shared-platform-utilities` workspace. Without it the AWS Load Balancer
  Controller attaches a managed security group open to `0.0.0.0/0` and the shared ALB stops
  being office/VPN-only.
- `serviceAccount.roleArn` — only if this app has its own AWS resources (see below).

`role-to-assume` is **not** a placeholder. `BetterCraftGHARole` is one shared role trusted
by every `repo:BetterCollective/better-craft-*` on `main` and tags, so the ARN is identical
in every app repo. The workflow reads it from `secrets.AWS_BETTER_CRAFT_ROLE_TO_ASSUME` —
set that as an **organisation** secret once and repos created from this template inherit it.

## The build pipeline

`.github/workflows/build-and-push.yml` runs on pushes to `main` and on any tag.

**`guard` job** decides whether there is anything to build:

- Skips entirely in the template repository (checked by both `is_template` and repo name).
- Skips, green, when `k8s/APP_NAME` is still present — the expected state on the first push
  of a freshly created repo. The job summary prints the rename command.
- **Fails** when the rename is half-done: the repo name lacks the `better-craft-` prefix,
  the chart folder does not match the repo name, `SHORT_NAME` still appears inside the
  chart, or `image.repository` disagrees with the derived ECR path. Better a red build than
  an Application ArgoCD cannot sync.

**`build-and-push` job**, gated on the guard, then does four things in order:

1. **Verify the app** — `pnpm install --frozen-lockfile`, then `pnpm run --if-present lint`,
   `pnpm run build`, `pnpm run --if-present test`. Add real `lint`/`test` scripts to
   `package.json` and they gate the image automatically.
2. **Verify the chart** — `helm lint` and `helm template` against both values files, the
   same way ArgoCD renders it.
3. **Build and push** — Buildx with a GitHub Actions layer cache, `linux/amd64`, pushed to
   ECR under two tags: the short commit SHA (or the git tag name, for tag builds) and
   `latest`.
4. **Pin the tag** — rewrites `k8s/<app>/values_image_tag.yaml` with the resolved tag and
   commits it to `main`. **This commit is the deploy.** ArgoCD only redeploys when git
   changes, so a chart pinned at `latest` would never resync. Tag builds commit onto `main`
   too.

Consequences worth knowing:

- The trigger has `paths-ignore: ['k8s/**']`, so the pipeline's own commit does not
  re-trigger it. It also means a chart-only edit does not rebuild the image — ArgoCD picks
  that up from git on its own.
- The push uses the default `GITHUB_TOKEN`. If `main` is protected, allow that actor to push
  or the deploy step fails after the image is already in ECR.
- Runs are serialised with a `concurrency` group, since every run ends in a push to `main`.
- Never hand-edit `values_image_tag.yaml`; CI overwrites it.

## Onboarding a new app

1. Create the repo from this template. **The name must start with `better-craft-`** — that
   prefix is what the ArgoCD ApplicationSet matches on.
2. Run the rename above.
3. In `terraform-bc`, add one entry to `local.ecr_repositories` in
   `Project/better-craft/227843491785/eu-west-1/shared/locals.tf`:
   ```hcl
   my-app = { registry_name = "better-craft/my-app/production", retention_days = 7 }
   ```
   PR, merge, apply. No IAM change — the role and its ECR push policy already cover
   `better-craft/*`.
4. Push to `main` or push a tag. CI assumes `BetterCraftGHARole` via OIDC, pushes the image,
   then commits the tag into `k8s/<app>/values_image_tag.yaml` — which triggers the rollout.
5. Set `ingress.enabled: true` when the app should be reachable.
6. Wait for discovery. ArgoCD is not exposed publicly, so GitHub cannot deliver a webhook —
   the SCM Provider generator polls. A new repo becomes an Application within the poll
   interval (a few minutes by default), not instantly.

The hostname `<app>.better-craft.bettercollective.dev` needs no certificate and no DNS
record of its own: one wildcard ACM cert is attached at the IngressClassParams level and one
wildcard Route53 alias points at the shared ALB.

## Per-app AWS resources (most apps: skip this)

Only if the app needs its own S3 bucket, RDS instance, extra Parameter Store access, etc.
Give it its own folder in `terraform-bc` at
`Project/better-craft-<app-name>/227843491785/eu-west-1/production/`.

Set `serviceAccount.create: true` and `serviceAccount.roleArn` in `values.yaml`. The chart
names the ServiceAccount after the chart, so the IRSA trust condition must be
`system:serviceaccount:better-craft:<app-name>` using that exact name — otherwise the trust
never matches and the pod silently gets no AWS access.

```hcl
module "eks_service_role" {
  source  = "otf.bettercollective.rocks/bettercollective/iam-role/bc"
  version = "1.2.2"

  role_name = "PlatformUtilitiesEKSBetterCraft${title("<app-name>")}ServiceRole"
  purpose   = "custom"

  custom_assume_role_schema = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "EKSOIDCAssumeRole"
      Effect    = "Allow"
      Principal = { Federated = data.terraform_remote_state.platform_utilities.outputs.eks_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${data.terraform_remote_state.platform_utilities.outputs.eks_oidc_provider_name}:sub" = "system:serviceaccount:better-craft:<app-name>"
          "${data.terraform_remote_state.platform_utilities.outputs.eks_oidc_provider_name}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  inline_policies = [ /* only what this app's pod actually needs, scoped to its own ARNs */ ]
  tags            = local.default_tags
}
```

`Project/video-infographics-tool/227843491785/eu-west-1/production/` is the worked example
to copy, including the `data.terraform_remote_state` block.

## Verifying a new app

```bash
# renders the same files ArgoCD uses
helm template <app> k8s/<app> -f k8s/<app>/values.yaml -f k8s/<app>/values_image_tag.yaml

docker build -t <app>:local . && docker run --rm -p 3000:3000 <app>:local
curl -f http://localhost:3000/healthz   # must be 2xx before probes are wired to it

dig <app>.better-craft.bettercollective.dev
curl -v https://<app>.better-craft.bettercollective.dev/healthz  # clean TLS, no cert warning
```

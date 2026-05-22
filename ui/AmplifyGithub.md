# Consumer-Repo Distribution Plan — `@revstar/*` via GitHub Packages

**Status: planned, not yet implemented.** This doc captures the distribution model consumer repos will use once the React components and CDK constructs from this repo are extracted into `@revstar/*` npm packages. Until those packages are published, consumer repos copy files directly from this `react-frontend/` folder (see [`README.md`](./README.md) for the component inventory) and reimplement the backend using the reference in [`Lambdas.md`](./Lambdas.md).

## The model

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  amplify-template-hub        │        │  Consumer repo (client)      │
│  (this repo)                 │        │                              │
│                              │        │   package.json:              │
│  react-frontend/  ───────┐   │        │     "@revstar/react-auth"    │
│    (source)              │   │        │     "@revstar/cdk-auth"      │
│                          │   │        │     "@revstar/react-file-    │
│  CI publishes to         │   │        │        upload"               │
│  GitHub Packages ────────┼───┼───────▶│                              │
│  npm registry:           │   │        │   .npmrc:                    │
│    @revstar:registry=    │   │        │     @revstar:registry=       │
│      https://            │   │        │       https://npm.pkg.       │
│      npm.pkg.github.com  │   │        │       github.com             │
└──────────────────────────┘   │        └──────────────────────────────┘
                               │
                               │  Access controlled by GitHub
                               │  fine-grained PAT with
                               │  `read:packages` on this repo
```

Consumer repos install `@revstar/*` packages like any other npm dependency. Auth is handled by a GitHub fine-grained PAT with `read:packages` scope on this repo. Revoking the PAT revokes `npm install` access — already-shipped builds keep working because packages are baked in.

## Quick Start for Consumer Repos

### 1. Configure npm to pull `@revstar` packages from GitHub Packages

Create `.npmrc` in the root of the consumer repo (and in any subdirectories that run `npm install` independently, like `infra/` and `react-frontend/`):

```ini
@revstar:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

`@revstar/*` resolves against GitHub Packages. Everything else still comes from the public npm registry.

### 2. Set up authentication

**Local dev:**

```bash
# Option A: GitHub CLI (recommended)
gh auth login
export GITHUB_PACKAGES_TOKEN=$(gh auth token)

# Option B: Personal Access Token
# Generate at: https://github.com/settings/tokens
# Required scope: read:packages
export GITHUB_PACKAGES_TOKEN=ghp_xxxxxxxxxxxx
```

**CI/CD — Amplify:**

Amplify Console → App settings → Environment variables:
- Key: `GITHUB_PACKAGES_TOKEN`
- Value: the read-only PAT

**CI/CD — CodePipeline / CodeBuild:**

Store the token in AWS Secrets Manager, reference it in the buildspec:

```yaml
env:
  secrets-manager:
    GITHUB_PACKAGES_TOKEN: "revstar/github-packages-token:token"
```

**CI/CD — GitHub Actions:**

```yaml
- uses: actions/setup-node@v4
  with:
    registry-url: https://npm.pkg.github.com
    scope: '@revstar'
- run: npm ci
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_PACKAGES_TOKEN }}
```

### 3. Install packages

```bash
# CDK infrastructure packages
cd infra
npm install @revstar/cdk-auth @revstar/cdk-file-upload @revstar/cdk-tenant-kb

# React frontend packages
cd react-frontend
npm install @revstar/react-auth @revstar/react-file-upload @revstar/shared-types
```

## Planned Packages

### Frontend packages — extracted from `react-frontend/src`

| Package | Description | Source in this repo |
|---|---|---|
| `@revstar/react-auth` | Dual-mode auth provider (mock/Cognito), login, register, verify email, forgot password, admin user panel | `src/auth/AuthContext.tsx`, `src/components/auth/*`, `src/components/admin/AdminUserPanel.tsx`, `src/services/cognito.ts`, `src/services/mockCognito.ts` |
| `@revstar/react-file-upload` | Upload button, visibility toggle (shared/private), progress indicator, pre-signed S3 upload client | `src/components/UploadButton.tsx`, `src/components/UploadProgress.tsx`, `src/components/VisibilityToggle.tsx`, `src/services/upload.ts`, `src/services/mockUpload.ts` |
| `@revstar/shared-types` | TypeScript types shared across packages (`AuthUser`, `AuthMode`, `FileVisibility`, `UploadState`, etc.) | `src/types/index.ts`, plus type exports from `services/*` |

### Backend packages — to be built from `Lambdas.md` reference

| Package | Description | Reference in `Lambdas.md` |
|---|---|---|
| `@revstar/cdk-auth` | CDK L3 construct: Cognito User Pool with self-signup, domain restriction, user groups, pre-signup + post-confirmation Lambda triggers, admin invite/list API | Cognito setup + `pre-signup` + `post-confirmation` + `admin` Lambdas + `/admin/*` routes |
| `@revstar/cdk-file-upload` | CDK L3 construct: pre-signed S3 upload Lambda with tenant/user scoping, file-type validation, shared/private visibility | `upload` Lambda + `POST /upload-url` + S3 bucket + CORS + IAM |
| `@revstar/cdk-tenant-kb` | CDK L3 construct: Bedrock Knowledge Base with OpenSearch vector store, S3 data source + ingestion, visibility-aware RAG query | `VectorKnowledgeBase` + `ingest` + `query` Lambdas + `POST /docs` route |

## Feature Flags (once packages exist)

Features toggle at two layers — infrastructure (CDK) and frontend (React env vars).

### CDK Feature Flags (build-time, per-deployment)

In the consumer repo's `infra/cdk.json`:

```jsonc
{
  "context": {
    "features": {
      "auth": true,
      "selfSignup": true,
      "fileUpload": true,
      "tenantKb": false
    },
    "allowedEmailDomains": ["@clientdomain.com"],
    "maxUploadSizeMb": 50,
    "allowedUploadTypes": "pdf,docx,doc,xlsx,xls,pptx,ppt,txt,csv,md,html,json,jpeg,jpg,png"
  }
}
```

### CDK Usage with Feature Flags

```typescript
import { CognitoAuth } from '@revstar/cdk-auth';
import { FileUpload } from '@revstar/cdk-file-upload';
import { TenantKnowledgeBase } from '@revstar/cdk-tenant-kb';

const features = this.node.tryGetContext('features') || {};

let auth;
if (features.auth !== false) {
  auth = new CognitoAuth(this, 'Auth', {
    selfSignupEnabled: features.selfSignup !== false,
    allowedDomains: this.node.tryGetContext('allowedEmailDomains') || ['@revstarconsulting.com'],
    userGroups: ['admin', 'analyst', 'viewer'],
  });
}

if (features.fileUpload !== false && auth) {
  new FileUpload(this, 'Upload', {
    bucket: docsBucket,
    api: apiGateway,
    authorizer: auth.authorizer,
    maxFileSizeMb: this.node.tryGetContext('maxUploadSizeMb') || 50,
    tenantScoped: true,
  });
}

if (features.tenantKb !== false) {
  new TenantKnowledgeBase(this, 'TenantKB', {
    bucket: docsBucket,
    embeddingsModel: BedrockFoundationModel.TITAN_EMBED_TEXT_V2_1024,
  });
}
```

### React Feature Flags (build-time, via env vars)

In the consumer repo's `react-frontend/.env`:

```bash
# Auth mode: "mock" for demo, "cognito" for real AWS auth
REACT_APP_AUTH_MODE=cognito

# Cognito config (from CDK stack outputs)
REACT_APP_USER_POOL_ID=us-east-1_xxxxx
REACT_APP_USER_POOL_CLIENT_ID=xxxxx

# Feature toggles
REACT_APP_FEATURE_FILE_UPLOAD=true
REACT_APP_FEATURE_ADMIN_PANEL=true

# Auth restrictions
REACT_APP_ALLOWED_EMAIL_DOMAINS=@clientdomain.com
```

### React Usage with Feature Flags

```tsx
import { AuthProvider, AuthRouter } from '@revstar/react-auth';
import { UploadButton } from '@revstar/react-file-upload';

const FEATURES = {
  fileUpload: process.env.REACT_APP_FEATURE_FILE_UPLOAD === 'true',
  adminPanel: process.env.REACT_APP_FEATURE_ADMIN_PANEL === 'true',
};

function App() {
  return (
    <AuthProvider mode={process.env.REACT_APP_AUTH_MODE || 'mock'}>
      <ChatInterface
        uploadButton={FEATURES.fileUpload ? <UploadButton /> : null}
      />
    </AuthProvider>
  );
}
```

## Client Access Management

### Granting Access

Generate a read-only PAT per client engagement:

1. https://github.com/settings/tokens → **fine-grained token**
2. Repository access: `revstarconsulting/amplify-template-hub` (read-only)
3. Permissions: `read:packages`
4. Set expiration based on engagement timeline
5. Hand the token to the client DevOps team for their CI/CD

For org-level control, replace PATs with a GitHub App installation.

### Revoking Access

When an engagement ends:

1. Revoke the PAT at https://github.com/settings/tokens
2. Client can no longer `npm install` new versions
3. Already-deployed code is unaffected — packages are baked into the build

## Deployment Checklist for New Client Projects

```bash
# 1. Clone or create project from template
gh repo create client-project --template revstarconsulting/amplify-template-hub

# 2. Add .npmrc for GitHub Packages
echo '@revstar:registry=https://npm.pkg.github.com' > .npmrc
echo '//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}' >> .npmrc
cp .npmrc infra/.npmrc
cp .npmrc react-frontend/.npmrc

# 3. Set the token
export GITHUB_PACKAGES_TOKEN=ghp_xxxxxxxxxxxx

# 4. Install packages
cd infra && npm install @revstar/cdk-auth @revstar/cdk-file-upload
cd ../react-frontend && npm install @revstar/react-auth @revstar/react-file-upload

# 5. Configure features in cdk.json
# Edit infra/cdk.json → set features, allowedEmailDomains, etc.

# 6. Configure frontend env vars
# Edit react-frontend/.env → set REACT_APP_AUTH_MODE, feature flags, etc.

# 7. Deploy
cd infra && npx cdk deploy

# 8. Set Amplify env vars from CDK outputs
# REACT_APP_USER_POOL_ID, REACT_APP_USER_POOL_CLIENT_ID, REACT_APP_API_URL
```

## Versioning

Packages will use [changesets](https://github.com/changesets/changesets) for versioning, each following semver:

- **Patch** (1.0.x): Bug fixes, no API changes
- **Minor** (1.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

Consumer repos pin to a version range in `package.json`:

```jsonc
{
  "@revstar/cdk-auth": "^1.2.0"   // accepts 1.2.0, 1.3.0, etc. but not 2.0.0
}
```

To update to the latest compatible version:

```bash
npm update @revstar/cdk-auth
```

## Support

For issues with `@revstar/*` packages, open an issue at:
https://github.com/revstarconsulting/amplify-template-hub/issues

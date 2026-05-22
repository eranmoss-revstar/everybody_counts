# Amplify Template Hub — react-frontend

A runnable React + TypeScript + Tailwind component library of reusable Amplify-era frontend pieces — auth flows, file upload, admin user management, RAG chat UI. Every feature is fully functional against in-memory mocks by default and flips to real AWS Cognito + API Gateway + S3 + Bedrock by setting one env var. Designed for copy-paste into consumer projects.

Companion docs in this folder:
- [`Lambdas.md`](./Lambdas.md) — reference backend (six Python Lambdas + full CDK stack) for flipping to real mode
- [`AmplifyGithub.md`](./AmplifyGithub.md) — planned `@revstar/*` package distribution model (GitHub Packages)

## How it's meant to be used

This is **not** a monolithic app you fork and customize. It's a grab-bag of production-quality components paired with service-layer abstractions. The intended workflow:

1. **Explore the demo.** `npm install && npm start` — everything runs on mocks, every screen is reachable.
2. **Pick the features you want.** Copy individual components (`LoginForm`, `UploadButton`, `AdminUserPanel`, etc.) into your target project.
3. **Flip a switch to go real.** Each service has a paired mock. Setting `REACT_APP_AUTH_MODE=cognito` (and deploying the backend from [`Lambdas.md`](./Lambdas.md)) swaps every mock for the real implementation — no component changes.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

Production build: `npm run build`.

## Demo login

- **Username**: `testuser` (or any valid email)
- **Password**: `demo123`

Registration, email verification, forgot password, admin invite, and file upload all work end-to-end in mock mode.

### Accessing the admin panel

`mockCognito.ts` grants the `admin` Cognito group to any email starting with `admin`. To unlock `AdminUserPanel`:

1. Log in as `admin@demo.com / demo123` (or any `admin*@*` email).
2. Open **Settings** from the sidebar footer.
3. The admin section (seeded user list + invite form) renders below the Theme card.

### Registration allowlist

`RegisterForm` reads `REACT_APP_ALLOWED_EMAIL_DOMAINS` (comma-separated). Empty or unset = any email accepted (demo default). When set, `RegisterForm` enforces it client-side; the `pre-signup` Lambda enforces the same list server-side in real mode.

## Architecture — how mocking works

Every service that touches an external system lives in `src/services/` as a pair — one real module, one mock — with a thin selector that picks between them based on `REACT_APP_AUTH_MODE`:

```
services/
├── cognito.ts       │ authService.ts       │ mockCognito.ts
├── upload.ts        │ uploadService.ts     │ mockUpload.ts
├── admin.ts         │ adminService.ts      │ mockAdmin.ts
├── api.ts           │ chatService.ts       │ mockApi.ts
└── (components only ever import the *Service.ts files)
```

Components never touch the SDK or `fetch` directly. They import from `*Service.ts`, which reads `REACT_APP_AUTH_MODE` at module load and exports the real or mock implementation. This means:

- **Copy a component → get working code.** If you lift `UploadButton.tsx` into your own project, it imports from `uploadService`. Drop in the real `upload.ts` alongside, and it works against your backend with zero edits.
- **Demo stays honest.** The mock implementations match the real interfaces exactly (same function signatures, same return shapes), so demo behaviour is a true preview.
- **Single toggle.** `REACT_APP_AUTH_MODE=mock` (default) → everything mocked. `REACT_APP_AUTH_MODE=cognito` → everything real.

### Selector summary

| Selector | Real implementation | Mock implementation |
|---|---|---|
| `authService.ts` | `cognito.ts` (amazon-cognito-identity-js) | `mockCognito.ts` |
| `uploadService.ts` | `upload.ts` (pre-signed S3 PUT) | `mockUpload.ts` (simulated progress) |
| `adminService.ts` | `admin.ts` (`POST /admin/invite-user`, `GET /admin/users`) | `mockAdmin.ts` (seeded users) |
| `chatService.ts` | `api.ts` (`POST /docs`) | `mockApi.ts` (canned responses) |

## What's included

| Feature | Files | Notes |
|---|---|---|
| **Auth (Cognito)** | `auth/AuthContext.tsx`, `components/auth/LoginForm.tsx`, `RegisterForm.tsx`, `VerifyEmail.tsx`, `ForgotPassword.tsx`, `AuthRouter.tsx` | Full login + self-signup + email verification + forgot-password flow. Mock mode accepts `testuser / demo123` (or any email + `demo123`) and any 6-digit verification code. |
| **Admin user panel** | `components/admin/AdminUserPanel.tsx` | Lists users, invites new users to Cognito groups. Only renders for users in the `admin` group. Mock mode seeds four demo users. |
| **File upload** | `components/UploadButton.tsx`, `UploadProgress.tsx`, `VisibilityToggle.tsx` | Pre-signed S3 PUT URL flow with shared/private visibility + progress bar. Mock mode simulates upload progress. |
| **RAG chat** | `components/ChatInterface.tsx`, `MessageBubble.tsx`, `Sidebar.tsx` | Chat interface with session management + Bedrock Knowledge Base integration. Mock mode returns canned responses. |
| **Theme** | `contexts/ThemeContext.tsx` | Dark/light mode toggle with system-preference default. |
| **Utilities** | `utils/formatters.ts`, `utils/sessionManager.ts`, `types/index.ts` | Text formatters; 30-min idle watchdog that fires `session:timeout` CustomEvent (the app auto-logs-out + shows a toast); shared TypeScript types. |

## Environment

`.env.example` documents the knobs. In short:

- `REACT_APP_AUTH_MODE` — `mock` (default) or `cognito`. Flips every service between in-memory and real AWS.
- When `cognito`: supply `REACT_APP_API_URL`, `REACT_APP_USER_POOL_ID`, `REACT_APP_USER_POOL_CLIENT_ID` from CDK stack outputs (see [`Lambdas.md`](./Lambdas.md)).
- `REACT_APP_ALLOWED_EMAIL_DOMAINS` — comma-separated. Empty/unset = unrestricted (demo default). When set, enforced by `RegisterForm` client-side and by the pre-signup Lambda server-side in real mode.

## Directory layout

```
src/
├── App.tsx                        root + auth gating + session-timeout toast
├── index.tsx                      CRA entry point
├── index.css                      Tailwind + custom styles
│
├── auth/
│   └── AuthContext.tsx            React context wrapping authService
│
├── contexts/
│   └── ThemeContext.tsx           dark/light mode
│
├── components/
│   ├── ChatInterface.tsx          chat pane + upload integration
│   ├── MessageBubble.tsx          single message renderer
│   ├── Sidebar.tsx                session list + settings modal (mounts admin panel for admins)
│   ├── UploadButton.tsx           file picker
│   ├── UploadProgress.tsx         upload status indicator
│   ├── VisibilityToggle.tsx       shared/private switch
│   │
│   ├── auth/
│   │   ├── AuthRouter.tsx         login / register / verify / forgot router
│   │   ├── LoginForm.tsx
│   │   ├── RegisterForm.tsx
│   │   ├── VerifyEmail.tsx
│   │   └── ForgotPassword.tsx
│   │
│   └── admin/
│       └── AdminUserPanel.tsx     admin-only user list + invite form
│
├── services/
│   ├── authService.ts  cognito.ts  mockCognito.ts
│   ├── uploadService.ts  upload.ts  mockUpload.ts
│   ├── adminService.ts  admin.ts  mockAdmin.ts
│   └── chatService.ts  api.ts  mockApi.ts
│
├── types/
│   └── index.ts                   shared TypeScript types
│
└── utils/
    ├── formatters.ts              text formatting helpers
    └── sessionManager.ts          30-min idle watchdog; fires `session:timeout` CustomEvent
```

## Picking components for your own project

1. Identify the selector(s) a component depends on (see imports).
2. Copy the selector file + its real + mock siblings (or just the real one).
3. Copy the component(s).
4. Copy any referenced contexts (`AuthContext`, `ThemeContext`) and `types/index.ts` entries.

Example — lifting the register + verify flow:

```
src/components/auth/RegisterForm.tsx      ┐
src/components/auth/VerifyEmail.tsx       │ the UI
src/components/auth/AuthRouter.tsx        ┘  (or build your own routing)
src/auth/AuthContext.tsx                  ┐
src/services/authService.ts               │ auth plumbing
src/services/cognito.ts                   │
src/services/mockCognito.ts               │  (drop mockCognito.ts if you
src/types/index.ts                        ┘   never need mock mode)
```

## Flipping to real mode

1. Deploy the backend. See [`Lambdas.md`](./Lambdas.md) for every handler (admin, pre-signup, post-confirmation, upload, ingest, query) plus the full CDK stack that ties them to Cognito + API Gateway + S3 + Bedrock.
2. Set the frontend env vars from CDK outputs:
   ```bash
   # react-frontend/.env
   REACT_APP_AUTH_MODE=cognito
   REACT_APP_API_URL=https://xxxx.execute-api.us-east-1.amazonaws.com/prod/
   REACT_APP_USER_POOL_ID=us-east-1_xxxxx
   REACT_APP_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
   REACT_APP_ALLOWED_EMAIL_DOMAINS=@clientdomain.com
   ```
3. `npm start` — selectors now route to real Cognito + API Gateway. No component changes.

## Future: `@revstar/*` packages

The longer-term plan is to publish each feature area as an npm package on GitHub Packages so consumer repos can `npm install @revstar/react-auth` instead of copy-pasting. The distribution model — `.npmrc`, PAT handoff, feature flags, CDK package table, CI wiring — is documented in [`AmplifyGithub.md`](./AmplifyGithub.md).

Until those packages exist, copy-paste is the intended workflow.

## Stack

- React 18 + TypeScript 4.9 (Create React App 5)
- Tailwind CSS 3.3
- lucide-react (icons)
- amazon-cognito-identity-js (real-mode auth only)

## Amplify deployment

The app ships with `amplify.yml` for zero-config AWS Amplify hosting. Set env vars in the Amplify Console (App settings → Environment variables) — in particular `REACT_APP_AUTH_MODE=cognito` once the backend is deployed.

## Support

Issues, PRs, questions: https://github.com/revstarconsulting/amplify-template-hub/issues

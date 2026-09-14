# Signal Desk public website release — 2026-09-07

User authorized production deployment of selected light-purple homepage, English default with Chinese/Spanish, purple logo, and completed registration/login UI. Repository D:/cursor/tiktokaitool commit 5ed5e9f1ab53e20829ed995339b0e1b440479294 pushed GitHub main; clean exact HEAD==origin/main confirmed by deploy guard. Deployed via npm run cloudflare:deploy only. No migrations needed.

Production version: 37ba38ec-13b2-4457-9738-bc0e09335061.
87/87 tests, build and tsc passed. HTTPS homepage, /login, /login?mode=register, /api/health and purple SVG return 200. HTML checks confirmed new English homepage, Welcome back, Create your account, and absence of local-preview banner. Worktree remains clean after deployment.

Limitations: live email delivery, successful registration/session establishment not tested; no messages sent to users and no real accounts created. Full visual QA remains recorded as limited by automation viewport. Backend auth, permissions and publishing behavior reused unchanged.

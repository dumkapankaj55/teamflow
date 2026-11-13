# TeamFlow: implementation and interview guide

This guide explains the code paths in this repository. Start each feature at the page or route, follow the API call, and then follow the controller into its service and model. Local development commands are in the root README.

## Authentication and sessions

**What and why:** User accounts, sign-in, refresh, sign-out, profile changes, and password recovery establish identity before workspace access. The client keeps the short-lived access token in memory; the server sends the refresh token in an HTTP-only cookie and stores only its hash. Password recovery sends a short-lived link plus a six digit email code, then requires a password with at least eight characters, a number, and a special character.

**Technology and flow:** `AuthContext` owns the current user and access token. The Axios client in `client/src/services/api.js` adds the bearer token, sends credentials for cookie calls, and coordinates refresh after an expired access token. The API validates input with Zod, hashes passwords with bcryptjs, signs JWTs, and rotates refresh records in `server/services/authService.js`. Reset links and OTPs are random, hashed before storage, expire after 15 minutes, and are single use. The reset page renders Cloudflare Turnstile; `captchaService.js` verifies the one time CAPTCHA token through Siteverify before changing the password.

**MongoDB/API:** `User` stores identity, password hash, reset-link hash, OTP hash, attempt count, and expiry; `RefreshToken` stores a hash, owner, expiry, and revocation/rotation state. `/auth/register`, `/login`, `/refresh`, `/logout`, `/me`, `/forgot-password`, and `/reset-password` connect the UI to those services. Nodemailer sends reset messages when SMTP is configured; development mode can expose the reset URL and OTP for local use. Production requires real Turnstile keys and never accepts the published test keys.

**Common errors:** A failed refresh usually means the browser did not send cookies, the client origin is missing from CORS, or secure cookie settings do not match the environment. A reset link and code can only be used once and expire after 15 minutes; five incorrect codes require a new request. CAPTCHA failures usually mean the widget site key and server secret do not belong to the same Turnstile setup. Keep the access secret stable across API restarts in production.

**Interview review:** Why keep a refresh token in an HTTP-only cookie? Why hash refresh/reset tokens at rest? What does rotation prevent? How do you stop two simultaneous API failures from issuing several refresh requests?

## Organizations, tenancy, and roles

**What and why:** The same user can join several independent organizations. A `Membership` record owns the role for one user in one organization; role is not a global property on `User`.

**Technology and flow:** `requireMembership` resolves and verifies the active organization membership. `authorizeRoles` restricts operations by that membership's role. Organization services scope reads and writes to the organization ID and validate referenced users before adding members. Admin invitation tokens are stored as hashes and are accepted by the authenticated invitee.

**MongoDB/API:** `Organization`, `Membership`, and `Invitation` are joined using ObjectId references and unique indexes. API routes under `/organizations` and `/invitations` create workspaces, list memberships, issue/accept invitations, and manage roles. For user-owned notifications and records, the services also check resource ownership and tenant ID.

**Common errors:** A valid document ID does not prove permission to read that document. Every service path must scope by tenant after membership is checked. An invite must match the accepting user's email, be unexpired, and not have been used.

**Interview review:** What is tenant isolation? Why store role on Membership? How do compound indexes help enforce one membership per user/workspace? Where should authorization be enforced if a UI route is already protected?

## Projects and tasks

**What and why:** Projects group work; tasks carry assignee, status, priority, dates, and description. A Kanban board makes task state visible and lets the user move work between states.

**Technology and flow:** React pages use the shared Axios API client and reusable forms, dialogs, filters, and list states. The board uses dnd-kit; a drop calls the same task update API as a status selector, so a successful move persists to MongoDB. Server validators constrain fields and enums. The task service checks that the project and assignee belong to the current organization and applies role/assignee rules before writes.

**MongoDB/API:** `Project` and `Task` have organization references, timestamps, and indexes. Tasks reference projects, reporters, and optional assignees. `/projects` and `/tasks` support paginated lists; validators define status, priority, search, and filter inputs. Project and task activity is created by service operations rather than client-supplied history.

**Common errors:** A task can fail to save when its project is in a different workspace, its assignee is not a member, or a member attempts a manager-only operation. Kanban state should be changed only after the API request succeeds or rolled back on failure.

**Interview review:** Why keep both `organization` and `project` references on a task? How would you index a common tenant/status/assignee query? How should an optimistic UI update handle API failure?

## Comments, activity, and notifications

**What and why:** Comments support collaboration, activity explains changes, and persistent notifications bring assigned work and updates back to the user.

**Technology and flow:** A task comment request is validated and authorized against its task. The service records the comment, activity, and applicable notifications. Notifications are fetched and marked read by authenticated routes; the current release uses refresh/manual polling rather than sockets.

**MongoDB/API:** `Comment`, `ActivityLog`, and `Notification` refer to the organization and related task/user. Queries are scoped by task, organization, and recipient. Comment and activity lists are paginated.

**Common errors:** Do not accept author or recipient identity from a request body; derive it from the authenticated session and task state. When Mongoose populates a reference, use its `_id` when comparing IDs.

**Interview review:** Why keep an activity log separate from the current task document? When would a queue be useful for notification delivery? How can recipient filtering prevent another user from reading a notification?

## Dashboard and analytics

**What and why:** The dashboard summarizes the current workspace, while the analytics page helps managers understand task flow, project progress, and workload.

**Technology and flow:** React pages fetch API data and render charts using Recharts. The API gathers counts and grouped distributions using MongoDB queries/aggregations; the UI does not ship fixed production statistics. Analytics routes enforce role checks on the server.

**MongoDB/API:** `/analytics/overview` returns the member overview; `/analytics/tasks`, `/analytics/projects`, and `/analytics/team` provide manager/admin breakdowns. Query pipelines must retain an organization match to avoid cross-tenant aggregation.

**Common errors:** Empty workspaces should render empty states rather than misleading demo values. A chart mismatch is often caused by a status enum or date boundary that differs between the API and UI.

**Interview review:** Why aggregate close to the database? How do you keep analytics tenant-safe? When would caching be safe, and what invalidates the cache?

## UI architecture, tests, and deployment

Reusable controls live in `client/src/components`; authenticated pages share `AppLayout`. `ProtectedRoute` handles signed-in navigation and `RoleProtectedRoute` improves navigation UX; backend authorization remains the actual security boundary. Vitest and React Testing Library cover client interaction. Jest and Supertest cover health, auth, membership, permissions, and multi-tenant integration paths against a separate test database.

Production configuration is described in the root README and `render.yaml`. Before a public launch, use managed secrets, Atlas network rules, real SMTP, HTTPS origins, and verify cookie behavior across the Vercel and Render domains. Deployment configuration is present, but no public deployment has been verified from this workspace.

**Common errors:** Ensure the API URL includes `/api/v1`, CORS includes the exact client origin, MongoDB allows the Render service, and the test database is not a production database. `COOKIE_SAME_SITE=none` requires `COOKIE_SECURE=true` in browsers.

**Interview review:** What should be mocked in component tests versus integration tests? How do same-site cookies affect cross-origin deployment? What checks would you add to a deployment pipeline?

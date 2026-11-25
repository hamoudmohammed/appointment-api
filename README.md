# Appointment REST API

A clean, production-ready REST API for appointment scheduling built with **TypeScript**, **Node.js**, and **PostgreSQL**. Designed following Clean Architecture principles, strict type safety, input validation, automated testing, and cloud-ready containerization.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-85EA2D.svg?logo=openapi-initiative&logoColor=black)](#interactive-documentation-swagger-ui)
[![Tests](https://img.shields.io/badge/Tests-Native%20Node%20Runner-brightgreen.svg)](#testing)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED.svg)](Dockerfile)
[![CI](https://github.com/hamoudmohammed/appointment-api/actions/workflows/ci.yml/badge.svg)](https://github.com/hamoudmohammed/appointment-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Architecture & Design Decisions

- **Separation of Concerns & Repository Pattern:** 
  - `types/`: Strict TypeScript data models, DTOs (Data Transfer Objects), and lifecycle domain state types.
  - `repositories/`: Abstract `IAppointmentRepository` interface with `PostgresAppointmentRepository` for production/cloud environments (e.g., AWS RDS) and `InMemoryAppointmentRepository` for blazing-fast, isolated automated testing.
  - `services/`: Encapsulated domain business logic, input validation, lifecycle guards, and conflict detection decoupled from HTTP layers and database drivers.
  - `services/notificationService.ts`: Event-driven architecture utilizing Node.js `EventEmitter` to dispatch domain events (`appointment:created`, `appointment:cancelled`, `appointment:rescheduled`, `appointment:completed`) and generate automated customer notifications.
  - `utils/exporter.ts`: RFC 5545 iCalendar (`.ics`) generation for Google Calendar/Outlook import and RFC 4180 CSV spreadsheet export.
  - `db/`: Connection pooling (`pg.Pool`), automated schema verification, index optimization, and graceful connection teardown.
  - `http/helpers.ts`: Shared HTTP primitives (1 MB-bounded JSON body parsing, standardized JSON/HTML/attachment responses, query-filter parsing, and service error status mapping).
  - `routes/appointmentRoutes.ts`: Modular route handlers for all `/appointments` endpoints decoupled from server middleware concerns.
  - `app.ts`: Core HTTP request pipeline (correlation IDs, security/CORS headers, structured logging, Prometheus metrics, rate limiting, health probes, Swagger UI, and route delegation).
  - `server.ts`: Server bootstrapping, dependency injection, environment port binding, and graceful shutdown handling (`SIGTERM`/`SIGINT`).
- **Resilience & Concurrency Safety:** 
  - **Zero Race Conditions & Multi-Provider Isolation:** Double-booking prevention per provider is enforced both in the application domain layer and at the database engine level using a conditional unique index:
    ```sql
    CREATE UNIQUE INDEX idx_unique_confirmed_slot ON appointments (date, time, LOWER(provider)) WHERE status = 'CONFIRMED';
    ```
    Cancelled appointments automatically liberate the time slot, while distinct providers can be booked concurrently at the same time.
  - **Lifecycle State Machine:** Supports `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `NO_SHOW` with transition guards blocking modifications to cancelled or completed appointments.
  - **Idempotent Retries:** `POST /appointments` supports an optional `Idempotency-Key` header with SHA-256 payload fingerprinting (`Idempotency-Replayed: true` on safe replay, `409 IDEMPOTENCY_CONFLICT` on payload mismatch).
  - Strict payload size limit (1 MB max) to prevent memory exhaustion / DoS attacks.
  - In-memory rate limiting with sliding window (`429 Too Many Requests`, `Retry-After`, `X-RateLimit-*` headers) to safeguard against brute-force attacks.
  - API Key Authentication: Destructive administrative operations (such as `DELETE /appointments/:id`) are guarded via `X-API-Key` or `Authorization: Bearer <key>` headers (`401 Unauthorized`).
  - Hardened HTTP security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`) and CORS with `OPTIONS` preflight support.
  - Observability & Distributed Tracing: Structured JSON logging with request duration (`durationMs`), correlation IDs (`X-Request-Id`), and native Prometheus metrics (`/metrics`) for Grafana scraping.
  - Defends against invalid JSON and improper HTTP methods with clean HTTP status codes (`400`, `404`, `409`, `413`, `429`, `500`).
  - Native health check endpoint (`/health`) ready for container orchestrators (Docker, Kubernetes, AWS ECS/ALB).

---

## API Endpoints

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `GET` | `/docs` | Interactive Swagger UI API documentation | `200` |
| `GET` | `/openapi.json` | OpenAPI 3.0.3 specification schema | `200` |
| `GET` | `/health` / `/health/live` | Liveness probe (uptime & memory metrics) | `200` |
| `GET` | `/health/ready` | Database readiness probe (active ping & pool statistics) | `200`, `503` |
| `GET` | `/metrics` | Prometheus metrics for cloud monitoring and Grafana scraping | `200` |
| `GET` | `/appointments` | List appointments (supports `page`, `limit`, `date`, `startDate`, `endDate`, `status`, `customer`, `provider`, `serviceType`, `email`, `q`, `sortBy`, `sortOrder`) | `200`, `400` |
| `GET` | `/appointments/slots` | Discover available and booked time slots for a given date, optional `provider`, and `slotDuration` (`15`, `30`, `45`, `60`) | `200`, `400` |
| `GET` | `/appointments/stats` | Aggregated appointment analytics (counts by status/service/provider, rates, busiest slots/dates) | `200`, `400` |
| `GET` | `/appointments/export` | Export appointments schedule in CSV or iCalendar (`.ics`) format | `200`, `400` |
| `GET` | `/appointments/:id` | Retrieve an appointment by numerical ID | `200`, `404` |
| `GET` | `/appointments/:id/history` | Retrieve chronological audit log of appointment lifecycle changes | `200`, `404` |
| `GET` | `/appointments/:id/export` | Download iCalendar invite (`.ics`) or CSV for a single appointment | `200`, `404` |
| `POST` | `/appointments` | Create a new appointment with validation & conflict checks | `201`, `400`, `409`, `413` |
| `POST` | `/appointments/:id/cancel` | Quick action to cancel an appointment and free its time slot | `200`, `400`, `404` |
| `POST` | `/appointments/:id/complete` | Mark an appointment session as completed | `200`, `400`, `404` |
| `POST` | `/appointments/:id/no-show` | Mark an appointment as no-show and record audit trail | `200`, `400`, `404` |
| `POST` | `/appointments/:id/confirm` | Confirm a pending appointment with slot conflict validation | `200`, `400`, `404`, `409` |
| `PATCH` | `/appointments/:id` | Update customer, reschedule date/time, or cancel status | `200`, `400`, `404`, `409` |
| `DELETE` | `/appointments/:id` | Remove an appointment (Admin protected via `X-API-Key`) | `200`, `401`, `404` |

---

## Interactive Documentation (Swagger UI)

The API includes a built-in, zero-dependency interactive **Swagger UI** interface:

- **Swagger UI Console:** [http://localhost:3000/docs](http://localhost:3000/docs)
- **OpenAPI 3.0 Schema:** [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)

You can explore all request schemas, response codes, and test endpoints directly inside your browser with the **"Try it out"** button.

### Example Payloads

#### Create Appointment Request (`POST /appointments`)
```json
{
  "customer": "Sarah Connor",
  "date": "2026-12-01",
  "time": "14:30"
}
```

#### Success Response (`201 Created`)
```json
{
  "message": "Appointment created successfully",
  "data": {
    "id": 2,
    "customer": "Sarah Connor",
    "date": "2026-12-01",
    "time": "14:30",
    "status": "CONFIRMED",
    "createdAt": "2026-11-14T17:00:00.000Z"
  }
}
```

#### Update / Reschedule Request (`PATCH /appointments/:id`)
```json
{
  "date": "2026-12-05",
  "time": "16:00",
  "status": "CONFIRMED"
}
```

#### Update Success Response (`200 OK`)
```json
{
  "message": "Appointment updated successfully",
  "data": {
    "id": 1,
    "customer": "Max Mustermann",
    "date": "2026-12-05",
    "time": "16:00",
    "status": "CONFIRMED",
    "createdAt": "2026-11-14T10:00:00.000Z"
  }
}
```

#### Delete Success Response (`200 OK`)
```json
{
  "message": "Appointment deleted successfully",
  "data": {
    "id": 1,
    "customer": "Max Mustermann",
    "date": "2026-11-20",
    "time": "10:00",
    "status": "CONFIRMED",
    "createdAt": "2026-11-14T10:00:00.000Z"
  }
}
```

#### Error Response (`400 Bad Request` / `409 Conflict`)
```json
{
  "error": "Time slot on 2026-11-20 at 10:00 is already booked. Please choose another time.",
  "errorType": "CONFLICT"
}
```

---

## Getting Started

### Prerequisites
- Node.js (v20+ recommended, v22 LTS tested)
- npm
- Docker & Docker Compose (optional for local PostgreSQL)

### Installation
```bash
git clone https://github.com/hamoudmohammed/appointment-api.git
cd appointment-api
npm install
```

### Running with Docker Compose (Recommended)

Start the API and PostgreSQL container stack together with automated health checks and persistent volume storage:

```bash
docker compose up -d
```

- API: [http://localhost:3000](http://localhost:3000)
- Swagger UI: [http://localhost:3000/docs](http://localhost:3000/docs)
- PostgreSQL Database: `localhost:5432` (database: `appointments_db`, user: `postgres`)

### Running Locally without Docker

You can run the API locally using an in-memory repository (ideal for quick testing and environments without Docker running):

```bash
# Start in development mode with In-Memory storage
USE_IN_MEMORY=true npm run dev

# Or connect to an external PostgreSQL instance
# (configure DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in .env)
npm run dev
```

### Production Build

```bash
# Compile TypeScript to dist/
npm run build

# Start production server
npm start
```

### Testing
Run automated unit and integration tests covering repository operations, service domain logic, and HTTP endpoints:
```bash
npm test
```

---

## Roadmap

- [x] Initial TypeScript REST API with clean layer separation
- [x] Input validation & defensive error handling
- [x] Automated unit testing suite
- [x] Containerization with multi-stage Dockerfile
- [x] Automated CI/CD pipeline using GitHub Actions (Lint, Test, Docker Build)
- [x] Persistent Database integration (PostgreSQL with Repository Pattern & Docker Compose)
- [ ] Infrastructure as Code (Terraform) for AWS deployment (RDS PostgreSQL + ECS Fargate)

---

## Author

**Mohammed Hamoud**  
B.Sc. in Computer Science — TU Dortmund  
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/mohammed-hamoud-732215201/)

# Appointment REST API

A clean, production-ready REST API for appointment scheduling built with **TypeScript** and **Node.js**. Designed following Clean Architecture principles, strict type safety, input validation, and automated testing.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-Native%20Node%20Runner-brightgreen.svg)](#testing)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-2496ED.svg)](Dockerfile)
[![CI](https://github.com/hamoudmohammed/appointment-api/actions/workflows/ci.yml/badge.svg)](https://github.com/hamoudmohammed/appointment-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Architecture & Design Decisions

- **Separation of Concerns:** 
  - `types/`: Strict TypeScript data models and DTOs (Data Transfer Objects).
  - `services/`: Encapsulated business logic and in-memory repository without HTTP dependencies.
  - `app.ts`: HTTP request dispatcher, payload size security limits, and standardized JSON responses.
  - `server.ts`: Server bootstrapping, environment port binding, and graceful shutdown handling (`SIGTERM`/`SIGINT`).
- **Resilience & Security:** 
  - Strict payload size limit (1 MB max) to prevent memory exhaustion / DoS attacks.
  - Defends against invalid JSON and improper HTTP methods with clean HTTP status codes (`400`, `404`, `413`, `500`).
  - Native health check endpoint (`/health`) ready for container orchestrators (Docker, Kubernetes, AWS ECS/ALB).
- **Zero-Dependency Core:** Implemented using native Node.js HTTP primitives and standard libraries to demonstrate deep fundamental knowledge of the runtime, without unnecessary external framework bloat.

---

## API Endpoints

| Method | Endpoint | Description | Status Codes |
|---|---|---|---|
| `GET` | `/health` | Liveness & health check probe | `200` |
| `GET` | `/appointments` | List all scheduled appointments | `200` |
| `GET` | `/appointments/:id` | Retrieve an appointment by numerical ID | `200`, `404` |
| `POST` | `/appointments` | Create a new appointment with validation | `201`, `400`, `413` |

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

#### Error Response (`400 Bad Request`)
```json
{
  "error": "Field \"date\" is required and must follow YYYY-MM-DD format."
}
```

---

## Getting Started

### Prerequisites
- Node.js (v20+ recommended)
- npm

### Installation
```bash
git clone https://github.com/hamoudmohammed/appointment-api.git
cd appointment-api
npm install
```

### Running Locally

```bash
# Start in development mode with auto-reload
npm run dev

# Compile TypeScript
npm run build

# Start compiled production server
npm start
```

### Running with Docker

Run the containerized application locally with Docker or Docker Compose:

```bash
# Using Docker Compose
docker compose up -d

# Or build and run standalone container
docker build -t appointment-api .
docker run -d -p 3000:3000 --name appointment-api appointment-api
```

### Testing
Run automated unit tests covering service logic, edge cases, and validation rules:
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
- [ ] Infrastructure as Code (Terraform) for AWS deployment

---

## Author

**Mohammed Hamoud**  
B.Sc. in Computer Science — TU Dortmund  
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=flat&logo=linkedin)](https://www.linkedin.com/in/mohammed-hamoud-732215201/)

# Appointment REST API

A clean, production-ready REST API for appointment scheduling built with **TypeScript** and **Node.js**. Designed following Clean Architecture principles, strict type safety, input validation, and automated testing.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0.3-85EA2D.svg?logo=openapi-initiative&logoColor=black)](#interactive-documentation-swagger-ui)
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
| `GET` | `/docs` | Interactive Swagger UI API documentation | `200` |
| `GET` | `/openapi.json` | OpenAPI 3.0.3 specification schema | `200` |
| `GET` | `/health` | Liveness & health check probe | `200` |
| `GET` | `/appointments` | List all scheduled appointments | `200` |
| `GET` | `/appointments/:id` | Retrieve an appointment by numerical ID | `200`, `404` |
| `POST` | `/appointments` | Create a new appointment with validation & conflict checks | `201`, `400`, `409`, `413` |
| `PATCH` | `/appointments/:id` | Update customer, reschedule date/time, or cancel status | `200`, `400`, `404`, `409` |
| `DELETE` | `/appointments/:id` | Remove an appointment and free its time slot | `200`, `404` |

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

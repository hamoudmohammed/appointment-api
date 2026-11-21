export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Appointment REST API',
    version: '1.0.0',
    description: 'A clean, production-ready REST API for appointment scheduling built with TypeScript and native Node.js HTTP primitives following Clean Architecture principles.',
    contact: {
      name: 'Mohammed Hamoud',
      url: 'https://github.com/hamoudmohammed/appointment-api'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: '/',
      description: 'Current Environment'
    }
  ],
  tags: [
    {
      name: 'System',
      description: 'Health & monitoring probes'
    },
    {
      name: 'Appointments',
      description: 'Appointment lifecycle management operations'
    }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness probe (process uptime & memory)',
        description: 'Returns server health, uptime in seconds, and memory metrics.',
        responses: {
          '200': {
            description: 'Server process is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'string', format: 'date-time', example: '2026-11-18T12:00:00.000Z' },
                    uptimeSeconds: { type: 'integer', example: 120 },
                    memory: {
                      type: 'object',
                      properties: {
                        rssMb: { type: 'number', example: 45.2 },
                        heapUsedMb: { type: 'number', example: 22.4 }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/health/ready': {
      get: {
        tags: ['System'],
        summary: 'Database readiness probe',
        description: 'Performs an active database ping (SELECT 1) and inspects connection pool metrics.',
        responses: {
          '200': {
            description: 'Database is healthy and ready to serve queries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'string', format: 'date-time' },
                    database: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'healthy' },
                        storage: { type: 'string', example: 'postgresql' },
                        latencyMs: { type: 'number', example: 1.25 },
                        pool: {
                          type: 'object',
                          properties: {
                            total: { type: 'integer', example: 10 },
                            idle: { type: 'integer', example: 9 },
                            waiting: { type: 'integer', example: 0 }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '503': {
            description: 'Database is unreachable or degraded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'unhealthy' },
                    timestamp: { type: 'string', format: 'date-time' },
                    database: { type: 'object' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Prometheus metrics endpoint',
        description: 'Exposes application and runtime metrics in Prometheus text-based exposition format for cloud observability.',
        responses: {
          '200': {
            description: 'Prometheus metrics in OpenMetrics text format',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                  example: '# HELP http_requests_total Total number of HTTP requests processed.\n# TYPE http_requests_total counter\nhttp_requests_total{method="GET",path="/appointments",status="200"} 42\n'
                }
              }
            }
          }
        }
      }
    },
    '/auth/verify': {
      post: {
        tags: ['System'],
        summary: 'Verify administrative API Key',
        description: 'Tests and verifies if the provided API Key is authentic and authorized.',
        security: [{ ApiKeyAuth: [] }],
        responses: {
          '200': {
            description: 'API Key is authentic',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'API Key successfully verified and authorized.' }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Invalid API Key provided',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Unauthorized: Invalid API key provided.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/appointments': {
      get: {
        tags: ['Appointments'],
        summary: 'List all appointments (with filtering & pagination)',
        description: 'Returns scheduled appointments with optional filtering by date, date range, status, customer, and pagination.',
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Page number (starts at 1)',
            schema: { type: 'integer', default: 1, minimum: 1 }
          },
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of items per page (max 100)',
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
          },
          {
            name: 'date',
            in: 'query',
            description: 'Filter by exact date (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2026-11-20' }
          },
          {
            name: 'startDate',
            in: 'query',
            description: 'Filter appointments on or after this date (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2026-11-01' }
          },
          {
            name: 'endDate',
            in: 'query',
            description: 'Filter appointments on or before this date (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2026-11-30' }
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by appointment status',
            schema: { type: 'string', enum: ['CONFIRMED', 'CANCELLED'] }
          },
          {
            name: 'customer',
            in: 'query',
            description: 'Case-insensitive filter by customer name',
            schema: { type: 'string', example: 'Max' }
          }
        ],
        responses: {
          '200': {
            description: 'List of appointments successfully retrieved',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total: { type: 'integer', example: 1 },
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 20 },
                    totalPages: { type: 'integer', example: 1 },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Appointment' }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid query parameters provided',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      post: {
        tags: ['Appointments'],
        summary: 'Create a new appointment',
        description: 'Books a new appointment slot with domain validation, double-booking conflict prevention, and optional Idempotency-Key support for safe network retries.',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            description: 'Optional unique key (max 128 chars) to safely retry appointment creation without duplicate bookings.',
            schema: { type: 'string', maxLength: 128, example: 'booking-req-8f3c2a10' }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateAppointmentDTO' }
            }
          }
        },
        responses: {
          '201': {
            description: 'Appointment created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Appointment created successfully' },
                    data: { $ref: '#/components/schemas/Appointment' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Validation Error (e.g. invalid date/time format or missing customer name)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '409': {
            description: 'Conflict - Slot is already booked by another confirmed appointment',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '413': {
            description: 'Payload Too Large (max 1 MB allowed)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/appointments/slots': {
      get: {
        tags: ['Appointments'],
        summary: 'Get available booking slots for a given date',
        description: 'Calculates all available and booked time slots based on business hours (08:00 - 17:00, 30 min intervals), excluding already confirmed appointments.',
        parameters: [
          {
            name: 'date',
            in: 'query',
            required: true,
            description: 'Date to inspect for available slots (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2026-11-20' }
          }
        ],
        responses: {
          '200': {
            description: 'Available slots breakdown for the specified date',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    date: { type: 'string', example: '2026-11-20' },
                    businessHours: {
                      type: 'object',
                      properties: {
                        start: { type: 'string', example: '08:00' },
                        end: { type: 'string', example: '17:00' },
                        slotDurationMinutes: { type: 'integer', example: 30 }
                      }
                    },
                    totalSlots: { type: 'integer', example: 18 },
                    availableCount: { type: 'integer', example: 17 },
                    bookedCount: { type: 'integer', example: 1 },
                    availableSlots: {
                      type: 'array',
                      items: { type: 'string' },
                      example: ['08:00', '08:30', '09:00', '09:30', '10:30']
                    },
                    slots: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          time: { type: 'string', example: '10:00' },
                          available: { type: 'boolean', example: false }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Validation Error (missing or invalid date format)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/appointments/stats': {
      get: {
        tags: ['Appointments'],
        summary: 'Get appointment analytics and statistics',
        description: 'Returns aggregated counts by status and service type, cancellation/completion rates, and busiest dates/time slots. Optionally filterable by date range.',
        parameters: [
          {
            name: 'startDate',
            in: 'query',
            description: 'Start date inclusive (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2026-11-01' }
          },
          {
            name: 'endDate',
            in: 'query',
            description: 'End date inclusive (YYYY-MM-DD)',
            schema: { type: 'string', format: 'date', example: '2026-11-30' }
          }
        ],
        responses: {
          '200': {
            description: 'Aggregated appointment statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    range: {
                      type: 'object',
                      properties: {
                        startDate: { type: 'string', nullable: true, example: '2026-11-01' },
                        endDate: { type: 'string', nullable: true, example: '2026-11-30' }
                      }
                    },
                    totalAppointments: { type: 'integer', example: 12 },
                    byStatus: {
                      type: 'object',
                      properties: {
                        PENDING: { type: 'integer', example: 1 },
                        CONFIRMED: { type: 'integer', example: 6 },
                        COMPLETED: { type: 'integer', example: 3 },
                        CANCELLED: { type: 'integer', example: 2 },
                        NO_SHOW: { type: 'integer', example: 0 }
                      }
                    },
                    byServiceType: {
                      type: 'object',
                      properties: {
                        CONSULTATION: { type: 'integer', example: 5 },
                        CHECKUP: { type: 'integer', example: 3 },
                        TREATMENT: { type: 'integer', example: 2 },
                        FOLLOW_UP: { type: 'integer', example: 2 }
                      }
                    },
                    cancellationRatePercent: { type: 'number', example: 16.67 },
                    completionRatePercent: { type: 'number', example: 25 },
                    busiestTimeSlots: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          time: { type: 'string', example: '10:00' },
                          count: { type: 'integer', example: 4 }
                        }
                      }
                    },
                    busiestDates: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string', example: '2026-11-20' },
                          count: { type: 'integer', example: 3 }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Invalid date range parameters',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/appointments/{id}': {
      get: {
        tags: ['Appointments'],
        summary: 'Get appointment by ID',
        description: 'Retrieves an appointment by its unique numeric ID.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique numeric appointment ID',
            schema: { type: 'integer', example: 1 }
          }
        ],
        responses: {
          '200': {
            description: 'Appointment found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/Appointment' }
                  }
                }
              }
            }
          },
          '404': {
            description: 'Appointment not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      patch: {
        tags: ['Appointments'],
        summary: 'Update or reschedule appointment',
        description: 'Updates appointment details, reschedules date/time (with conflict detection), or cancels status.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique numeric appointment ID',
            schema: { type: 'integer', example: 1 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateAppointmentDTO' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Appointment successfully updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Appointment updated successfully' },
                    data: { $ref: '#/components/schemas/Appointment' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Validation Error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'Appointment not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '409': {
            description: 'Conflict - Target slot already taken by another confirmed booking',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      },
      delete: {
        tags: ['Appointments'],
        summary: 'Delete appointment (Admin protected)',
        description: 'Removes an appointment permanently and frees its time slot. Requires valid X-API-Key header.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Unique numeric appointment ID',
            schema: { type: 'integer', example: 1 }
          }
        ],
        responses: {
          '200': {
            description: 'Appointment successfully deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Appointment deleted successfully' },
                    data: { $ref: '#/components/schemas/Appointment' }
                  }
                }
              }
            }
          },
          '401': {
            description: 'Unauthorized - Missing or invalid API key',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          '404': {
            description: 'Appointment not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/appointments/export': {
      get: {
        tags: ['Appointments'],
        summary: 'Export appointments (CSV or iCalendar)',
        description: 'Downloads schedule in CSV format or iCalendar (.ics) format compatible with Google Calendar, Apple Calendar, and Outlook.',
        parameters: [
          {
            name: 'format',
            in: 'query',
            description: 'Export format: "ics" or "csv"',
            schema: { type: 'string', enum: ['ics', 'csv'], default: 'ics' }
          },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by status',
            schema: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] }
          }
        ],
        responses: {
          '200': {
            description: 'Calendar file or CSV stream',
            content: {
              'text/calendar': { schema: { type: 'string' } },
              'text/csv': { schema: { type: 'string' } }
            }
          },
          '400': {
            description: 'Invalid format requested',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/appointments/{id}/cancel': {
      post: {
        tags: ['Appointments'],
        summary: 'Cancel an appointment (Quick Action)',
        description: 'Cancels the appointment and liberates its time slot.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          '200': {
            description: 'Appointment successfully cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Appointment cancelled successfully' },
                    data: { $ref: '#/components/schemas/Appointment' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Cannot cancel completed appointment',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '404': {
            description: 'Appointment not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    },
    '/appointments/{id}/complete': {
      post: {
        tags: ['Appointments'],
        summary: 'Mark an appointment as completed',
        description: 'Marks a confirmed appointment as completed after the session.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer' }
          }
        ],
        responses: {
          '200': {
            description: 'Appointment marked as completed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Appointment marked as completed successfully' },
                    data: { $ref: '#/components/schemas/Appointment' }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Cannot complete a cancelled appointment',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          },
          '404': {
            description: 'Appointment not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } }
            }
          }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Administrative API key required for destructive operations such as DELETE /appointments/:id'
      }
    },
    schemas: {
      Appointment: {
        type: 'object',
        required: ['id', 'customer', 'date', 'time', 'status', 'createdAt'],
        properties: {
          id: { type: 'integer', example: 1 },
          customer: { type: 'string', example: 'Max Mustermann' },
          email: { type: 'string', format: 'email', example: 'max@example.com' },
          phone: { type: 'string', example: '+49 151 12345678' },
          serviceType: {
            type: 'string',
            enum: ['CONSULTATION', 'CHECKUP', 'TREATMENT', 'FOLLOW_UP'],
            example: 'CONSULTATION'
          },
          notes: { type: 'string', example: 'Initial consultation notes' },
          date: { type: 'string', format: 'date', example: '2026-11-20', description: 'YYYY-MM-DD' },
          time: { type: 'string', example: '10:00', description: 'HH:mm (24h format)' },
          status: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
            example: 'CONFIRMED'
          },
          createdAt: { type: 'string', format: 'date-time', example: '2026-11-14T10:00:00.000Z' }
        }
      },
      CreateAppointmentDTO: {
        type: 'object',
        required: ['customer', 'date', 'time'],
        properties: {
          customer: { type: 'string', example: 'Sarah Connor' },
          email: { type: 'string', format: 'email', example: 'sarah@example.com' },
          phone: { type: 'string', example: '+1 555 0199' },
          serviceType: {
            type: 'string',
            enum: ['CONSULTATION', 'CHECKUP', 'TREATMENT', 'FOLLOW_UP'],
            example: 'CONSULTATION'
          },
          notes: { type: 'string', example: 'Needs follow-up' },
          date: { type: 'string', format: 'date', example: '2026-12-01', description: 'YYYY-MM-DD' },
          time: { type: 'string', example: '14:30', description: 'HH:mm (24h format)' }
        }
      },
      UpdateAppointmentDTO: {
        type: 'object',
        properties: {
          customer: { type: 'string', example: 'Sarah Connor Updated' },
          email: { type: 'string', format: 'email', example: 'sarah.updated@example.com' },
          phone: { type: 'string', example: '+1 555 0199' },
          serviceType: {
            type: 'string',
            enum: ['CONSULTATION', 'CHECKUP', 'TREATMENT', 'FOLLOW_UP'],
            example: 'CONSULTATION'
          },
          notes: { type: 'string', example: 'Updated notes' },
          date: { type: 'string', format: 'date', example: '2026-12-02' },
          time: { type: 'string', example: '15:00' },
          status: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
            example: 'CONFIRMED'
          }
        }
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', example: 'Time slot on 2026-11-20 at 10:00 is already booked.' },
          errorType: { type: 'string', example: 'CONFLICT' }
        }
      }
    }
  }
};

export const swaggerUiHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Appointment REST API - Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .topbar { display: none !important; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: 'BaseLayout'
      });

      // Intercept and strictly validate API Key before Swagger authorizes it
      document.addEventListener('click', async function(e) {
        const btn = e.target.closest('button.auth.authorize, button.modal-btn.auth');
        if (!btn) return;

        const modal = btn.closest('.modal-ux, .dialog-ux');
        if (!modal) return;

        const input = modal.querySelector('input[type="text"], input[type="password"]');
        if (!input) return;

        const enteredKey = input.value.trim();

        // Halt Swagger's default unconditional acceptance
        e.preventDefault();
        e.stopPropagation();

        let feedback = modal.querySelector('#custom-auth-feedback');
        if (!feedback) {
          feedback = document.createElement('div');
          feedback.id = 'custom-auth-feedback';
          feedback.style.marginTop = '12px';
          feedback.style.padding = '10px 14px';
          feedback.style.borderRadius = '6px';
          feedback.style.fontSize = '14px';
          feedback.style.fontWeight = 'bold';
          btn.parentNode.insertBefore(feedback, btn.nextSibling);
        }

        feedback.style.display = 'block';
        feedback.style.backgroundColor = '#e3f2fd';
        feedback.style.color = '#1565c0';
        feedback.style.border = '1px solid #90caf9';
        feedback.innerText = '⏳ Verifying API key with server...';

        try {
          const res = await fetch('/auth/verify', {
            method: 'POST',
            headers: { 'X-API-Key': enteredKey }
          });

          if (res.status === 200) {
            feedback.style.backgroundColor = '#e8f5e9';
            feedback.style.color = '#2e7d32';
            feedback.style.border = '1px solid #a5d6a7';
            feedback.innerText = '✅ Correct password! Authorized successfully.';

            // Authorize Swagger UI store
            if (ui && ui.authActions && ui.authActions.authorize) {
              ui.authActions.authorize({
                ApiKeyAuth: {
                  name: 'X-API-Key',
                  schema: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
                  value: enteredKey
                }
              });
            }
          } else {
            feedback.style.backgroundColor = '#ffebee';
            feedback.style.color = '#c62828';
            feedback.style.border = '1px solid #ef9a9a';
            feedback.innerText = '❌ Wrong password! Server rejected authorization (401 Unauthorized).';

            // Ensure Swagger does not mark as authorized
            if (ui && ui.authActions && ui.authActions.logout) {
              ui.authActions.logout(['ApiKeyAuth']);
            }
          }
        } catch (err) {
          feedback.style.backgroundColor = '#ffebee';
          feedback.style.color = '#c62828';
          feedback.innerText = '❌ Network error: Could not verify with server.';
        }
      }, true);
    };
  </script>
</body>
</html>`;

-- ========================================================
-- Schema Definition for Appointments Database (PostgreSQL)
-- ========================================================

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    customer VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    provider VARCHAR(100) NOT NULL DEFAULT 'General',
    service_type VARCHAR(50) NOT NULL DEFAULT 'CONSULTATION',
    notes TEXT,
    date DATE NOT NULL,
    time VARCHAR(5) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index to optimize querying appointments by date, status, provider, and service type
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (date, status);
CREATE INDEX IF NOT EXISTS idx_appointments_service_type ON appointments (service_type);
CREATE INDEX IF NOT EXISTS idx_appointments_provider ON appointments (LOWER(provider));

-- Conditional unique index to strictly guarantee double-booking prevention per provider at the database level.
-- Only 'CONFIRMED' appointments occupy a time slot for a provider; 'CANCELLED' appointments free the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot 
ON appointments (date, time, LOWER(provider)) 
WHERE status = 'CONFIRMED';

-- Seed initial appointment if table is empty
INSERT INTO appointments (customer, email, phone, provider, service_type, notes, date, time, status, created_at)
SELECT 'Max Mustermann', 'max@example.com', '+49 151 12345678', 'General', 'CONSULTATION', 'Initial consultation session', '2026-11-20', '10:00', 'CONFIRMED', '2026-11-14 10:00:00+00'
WHERE NOT EXISTS (
    SELECT 1 FROM appointments WHERE id = 1
);

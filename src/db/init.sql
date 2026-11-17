-- ========================================================
-- Schema Definition for Appointments Database (PostgreSQL)
-- ========================================================

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    customer VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    time VARCHAR(5) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index to optimize querying appointments by date and status
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments (date, status);

-- Conditional unique index to strictly guarantee double-booking prevention at the database level.
-- Only 'CONFIRMED' appointments occupy a time slot; 'CANCELLED' appointments free the slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_confirmed_slot 
ON appointments (date, time) 
WHERE status = 'CONFIRMED';

-- Seed initial appointment if table is empty
INSERT INTO appointments (customer, date, time, status, created_at)
SELECT 'Max Mustermann', '2026-11-20', '10:00', 'CONFIRMED', '2026-11-14 10:00:00+00'
WHERE NOT EXISTS (
    SELECT 1 FROM appointments WHERE id = 1
);

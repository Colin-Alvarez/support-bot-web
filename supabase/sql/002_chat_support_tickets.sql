-- Create tables for chat messages and support tickets

-- Table for storing chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Add indexes for efficient querying
  CONSTRAINT idx_chat_messages_session_timestamp UNIQUE (session_id, timestamp)
);

-- Create index for faster session-based queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id);

-- Table for storing support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  freshdesk_ticket_id TEXT,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  transcript JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create index for faster session-based queries
CREATE INDEX IF NOT EXISTS idx_support_tickets_session_id ON support_tickets (session_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_freshdesk_id ON support_tickets (freshdesk_ticket_id);

-- Create RLS policies for chat_messages
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Only allow service role to insert/update/delete
CREATE POLICY "Service role can do everything" 
  ON chat_messages 
  USING (true) 
  WITH CHECK (true);

-- Create RLS policies for support_tickets
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Only allow service role to insert/update/delete
CREATE POLICY "Service role can do everything" 
  ON support_tickets 
  USING (true) 
  WITH CHECK (true);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update the updated_at column
CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
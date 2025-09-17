# Freshdesk Integration for Support Bot

This document explains how to set up the Freshdesk integration for the Support Bot, which allows the bot to create support tickets in Freshdesk when it can't answer a user's question.

## Overview

The integration consists of three main components:

1. **Modified ask-bot function**: Detects when the bot can't answer a question and flags it for human help
2. **create-ticket function**: Handles creating tickets in Freshdesk via their API
3. **Updated widget**: Collects user information and creates a ticket with the chat transcript

## Setup Instructions

### 1. Environment Variables

Add the following environment variables to your Supabase project:

```
FRESHDESK_API_KEY=your_freshdesk_api_key
FRESHDESK_DOMAIN=your_freshdesk_domain
```

You can get your API key from the Freshdesk admin panel under Profile Settings > API Key.

### 2. Database Setup

Run the SQL migration to create the necessary tables:

```bash
# From your project root
supabase db push supabase/sql/002_chat_support_tickets.sql
```

This creates:
- `chat_messages` table for storing the conversation history
- `support_tickets` table for tracking created tickets

### 3. Deploy Supabase Functions

Deploy both the modified ask-bot function and the new create-ticket function:

```bash
# From your project root
supabase functions deploy ask-bot
supabase functions deploy create-ticket
```

### 4. Update Widget Configuration

In your widget script (`widget/supportbot.js`), update the API endpoints:

```javascript
const API_ASK = "https://egekczvpwozhhwgpgekp.functions.supabase.co/ask-bot";
const API_TICKET = "https://egekczvpwozhhwgpgekp.functions.supabase.co/create-ticket";
```

## How It Works

1. When a user asks a question, the bot searches the knowledge base for an answer
2. If the bot can't find a good answer (based on pattern matching or low confidence), it sets `needs_human_help: true` in the response
3. The widget detects this flag and offers the user the option to create a support ticket
4. If the user chooses to create a ticket, a form appears to collect their name, email, and additional details
5. When submitted, the form data and chat transcript are sent to the create-ticket function
6. The create-ticket function creates a ticket in Freshdesk with the chat transcript and notifies the user

## Customization

### Ticket Fields

You can customize the ticket fields in `create-ticket/index.ts`:

```typescript
const ticketData = {
  name,
  email,
  subject,
  description: ticketDescription,
  status: 2, // Open status
  priority: 2, // Medium priority
  source: 3, // Chat source
  custom_fields: {
    // Add your custom fields here
    session_id: session_id
  }
};
```

### Widget Appearance

The widget appearance can be customized in `widget/supportbot.css`.

## Troubleshooting

- **Ticket creation fails**: Check that your Freshdesk API key and domain are correct
- **Database errors**: Ensure the SQL migration has been applied correctly
- **CORS issues**: Make sure your domain is added to the allowed origins in Supabase

## Testing

You can test the integration by:

1. Asking a question the bot can't answer
2. Clicking "Create Ticket" when prompted
3. Filling out the form and submitting
4. Checking your Freshdesk account for the new ticket
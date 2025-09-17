---
description: Repository Information Overview
alwaysApply: true
---

# Support Bot Information

## Summary
A support chatbot application built with React and Supabase. The project consists of a web interface, a widget for embedding on websites, an ingestion tool for processing knowledge base content, and Supabase serverless functions for handling queries.

## Structure
- **src/**: Main React application source code
- **ingest/**: Knowledge base ingestion tool for processing support content
- **supabase/**: Supabase serverless functions and database schema
- **widget/**: Embeddable support bot widget for third-party websites
- **web/**: Additional web components
- **dist/**: Build output directory

## Language & Runtime
**Language**: TypeScript/JavaScript
**Version**: ES2020 target
**Build System**: Vite
**Package Manager**: npm

## Dependencies
**Main Dependencies**:
- React v19.1.1
- React DOM v19.1.1
- Supabase JS v2.57.4
- OpenAI v5.20.2 (ingest tool)
- Axios v1.12.2 (ingest tool)
- Cheerio v1.1.2 (ingest tool)
- JSDOM v27.0.0 (ingest tool)
- Deno (Supabase functions)

**Development Dependencies**:
- TypeScript v5.9.2
- Vite v7.1.5
- @vitejs/plugin-react v5.0.2
- ts-node v10.9.2 (ingest tool)

## Build & Installation
```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Ingest tool setup
cd ingest
npm install
```

## Projects

### Web Application
**Configuration File**: package.json, tsconfig.json, vite.config.ts

#### Language & Runtime
**Language**: TypeScript/React
**Version**: React v19.1.1
**Build System**: Vite v7.1.5
**Package Manager**: npm

#### Main Files
- **src/main.tsx**: Application entry point
- **src/App.tsx**: Main application component
- **src/components/SupportBotWidget.tsx**: Support bot widget component

#### Build & Installation
```bash
npm install
npm run dev   # Development server
npm run build # Production build
```

### Ingest Tool
**Configuration File**: ingest/package.json, ingest/tsconfig.json

#### Language & Runtime
**Language**: TypeScript/Node.js
**Version**: Node.js with TypeScript v5.9.2
**Package Manager**: npm

#### Dependencies
**Main Dependencies**:
- OpenAI v5.20.2
- Axios v1.12.2
- Cheerio v1.1.2
- JSDOM v27.0.0
- pg v8.16.3 (PostgreSQL client)

#### Main Files
- **ingest/index.ts**: Main ingestion script

#### Build & Installation
```bash
cd ingest
npm install
ts-node index.ts
```

### Supabase Functions
**Configuration File**: supabase/functions/deno.json

#### Language & Runtime
**Language**: TypeScript/Deno
**Runtime**: Deno
**Package Manager**: Deno modules

#### Dependencies
- Deno standard library (std/http/server)
- Supabase JS v2

#### Main Files
- **supabase/functions/ask-bot/index.ts**: Bot query handler function
- **supabase/functions/kb-sync/index.ts**: Knowledge base sync function
- **supabase/sql/schema.sql**: Database schema
- **supabase/sql/001_hybrid_search.sql**: Search functionality

### Widget
**Configuration File**: N/A (Standalone JavaScript)

#### Language & Runtime
**Language**: JavaScript
**Runtime**: Browser

#### Main Files
- **widget/supportbot.js**: Embeddable widget script
- **widget/supportbot.css**: Widget styling
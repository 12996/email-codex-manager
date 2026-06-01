import dotenv from 'dotenv';

dotenv.config();

export const config = {
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-session-secret',
  databasePath: process.env.DATABASE_PATH || './data/app.db',
  imap: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: String(process.env.IMAP_SECURE || 'true') === 'true',
  },
  mailFetchLimit: Number(process.env.MAIL_FETCH_LIMIT || 5),
  defaultReadLocation: process.env.DEFAULT_READ_LOCATION || 'inbox',
};

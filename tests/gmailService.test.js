/**
 * tests/gmailService.test.js
 *
 * Unit tests for gmailService.js.
 * Mocks the googleapis library so no real credentials are needed.
 */

jest.mock('googleapis', () => {
  const mockProfile = { data: { emailAddress: 'rovneralec@gmail.com', messagesTotal: 5000 } };
  const mockMessages = {
    list:  jest.fn().mockResolvedValue({ data: { messages: [{ id: 'msg1' }, { id: 'msg2' }] } }),
    get:   jest.fn().mockResolvedValue({
      data: {
        id: 'msg1',
        snippet: 'Hello world',
        threadId: 'thread1',
        labelIds: ['INBOX', 'UNREAD'],
        payload: {
          headers: [
            { name: 'From',    value: 'sender@example.com' },
            { name: 'Subject', value: 'Test Subject' },
            { name: 'Date',    value: 'Mon, 1 Jan 2026 12:00:00 +0000' },
            { name: 'To',      value: 'rovneralec@gmail.com' },
          ],
          body: { data: Buffer.from('Hello email body').toString('base64') },
          parts: [],
        },
      },
    }),
    modify:  jest.fn().mockResolvedValue({ data: {} }),
    trash:   jest.fn().mockResolvedValue({ data: {} }),
    send:    jest.fn().mockResolvedValue({ data: { id: 'sent1' } }),
    attachments: { get: jest.fn().mockResolvedValue({ data: { data: Buffer.from('PDF content').toString('base64') } }) },
  };
  const mockLabels = {
    list:   jest.fn().mockResolvedValue({ data: { labels: [{ id: 'LABEL_1', name: 'ALEC/URGENT' }] } }),
    create: jest.fn().mockResolvedValue({ data: { id: 'LABEL_NEW', name: 'ALEC/FYI' } }),
  };
  const mockGetProfile = jest.fn().mockResolvedValue(mockProfile);

  const mockGmail = jest.fn().mockReturnValue({
    users: { messages: mockMessages, labels: mockLabels, getProfile: mockGetProfile },
  });

  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          generateAuthUrl: jest.fn().mockReturnValue('https://auth.url'),
          setCredentials: jest.fn(),
          credentials: {},
        })),
      },
      gmail: mockGmail,
    },
  };
});

// Set env vars before requiring the service
process.env.GMAIL_CLIENT_ID     = 'test-client-id';
process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
process.env.GMAIL_REFRESH_TOKEN_ALEC       = 'test-refresh-alec';
process.env.GMAIL_REFRESH_TOKEN_PROPERTIES = 'test-refresh-props';

const gmailService = require('../services/gmailService');

describe('gmailService', () => {
  describe('status()', () => {
    it('returns configured:true when credentials are set', async () => {
      const s = await gmailService.status();
      expect(s.configured).toBe(true);
      expect(s.accounts).toBeDefined();
      expect(s.accounts.alec).toBeDefined();
    });
  });

  describe('listUnreadEmails()', () => {
    it('returns a list of email metadata', async () => {
      const emails = await gmailService.listUnreadEmails('alec', 5);
      expect(Array.isArray(emails)).toBe(true);
      expect(emails.length).toBeGreaterThan(0);
      expect(emails[0]).toHaveProperty('id');
      expect(emails[0]).toHaveProperty('subject');
    });

    it('throws for unknown account', async () => {
      await expect(gmailService.listUnreadEmails('unknown')).rejects.toThrow('Unknown Gmail account');
    });
  });

  describe('getEmailById()', () => {
    it('returns email with body and headers', async () => {
      const email = await gmailService.getEmailById('alec', 'msg1');
      expect(email.id).toBe('msg1');
      expect(email.subject).toBe('Test Subject');
      expect(email.from).toBe('sender@example.com');
      expect(typeof email.body).toBe('string');
    });
  });

  describe('triageEmail()', () => {
    it('falls back to heuristics when LLM is unavailable', async () => {
      // LLM fetch will fail (no server in test) — expects heuristic fallback
      const email = { subject: 'URGENT: Lease expiring', from: 'tenant@example.com', snippet: 'Your lease expires in 3 days' };
      const result = await gmailService.triageEmail('alec', email);
      expect(['URGENT', 'ACTION', 'FYI', 'SPAM']).toContain(result.priority);
      expect(result.reason).toBeDefined();
    });

    it('classifies spam keywords as SPAM', async () => {
      const email = { subject: 'Unsubscribe from our newsletter', from: 'marketing@spam.com', snippet: 'Click here to unsubscribe' };
      const result = await gmailService.triageEmail('alec', email);
      expect(result.priority).toBe('SPAM');
    });

    it('classifies urgent keywords as URGENT', async () => {
      const email = { subject: 'Eviction notice for Unit 4B', from: 'court@county.gov', snippet: 'Immediate action required' };
      const result = await gmailService.triageEmail('alec', email);
      expect(result.priority).toBe('URGENT');
    });
  });

  describe('archiveEmail()', () => {
    it('removes INBOX label', async () => {
      const result = await gmailService.archiveEmail('alec', 'msg1');
      expect(result.success).toBe(true);
      expect(result.action).toBe('archived');
    });
  });

  describe('labelEmail()', () => {
    it('applies a label to a message', async () => {
      const result = await gmailService.labelEmail('alec', 'msg1', 'ALEC/FYI');
      expect(result.success).toBe(true);
    });
  });

  describe('deleteEmail()', () => {
    it('moves message to Trash', async () => {
      const result = await gmailService.deleteEmail('alec', 'msg1');
      expect(result.success).toBe(true);
      expect(result.action).toBe('trashed');
    });
  });
});

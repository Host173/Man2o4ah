import { smtpConfig } from '../../config/smtp-config.js';
import { SmtpMailer } from './smtp-mailer.js';

const transport = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: transport.createTransport },
}));

const settings = {
  SMTP_ENABLED: 'true',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_SECURE: 'false',
  SMTP_FROM: 'platform@example.test',
  SMTP_TEST_INBOX: 'inbox@example.test',
};
const message = {
  deliveryKey: 'notification:one',
  to: 'recipient@example.test',
  subject: 'Confirmed',
  text: 'Your booking is confirmed.',
};

describe('SMTP adapter (GEN-01-B)', () => {
  beforeEach(() => {
    transport.createTransport
      .mockReset()
      .mockReturnValue({ sendMail: transport.sendMail });
    transport.sendMail
      .mockReset()
      .mockResolvedValue({ accepted: [settings.SMTP_TEST_INBOX] });
  });

  it('sends plain text exclusively to the test inbox in headers/envelope, with stable Message-ID', async () => {
    const mailer = new SmtpMailer(smtpConfig(settings));
    await mailer.send(message);
    await mailer.send(message);
    const first = transport.sendMail.mock.calls[0][0];
    expect(first).toMatchObject({
      to: settings.SMTP_TEST_INBOX,
      envelope: { from: settings.SMTP_FROM, to: [settings.SMTP_TEST_INBOX] },
      subject: message.subject,
      text: message.text,
    });
    expect(JSON.stringify(first)).not.toContain(message.to);
    expect(first).not.toHaveProperty('html');
    expect(first.messageId).toBe(transport.sendMail.mock.calls[1][0].messageId);
    expect(transport.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 15_000,
        socketTimeout: 15_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
  });

  it('uses production recipient with mandatory TLS', async () => {
    transport.sendMail.mockResolvedValue({ accepted: [message.to] });
    const mailer = new SmtpMailer(
      smtpConfig({ ...settings, NODE_ENV: 'production' }),
    );
    await mailer.send(message);
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: message.to }),
    );
    expect(transport.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ requireTLS: true }),
    );
  });

  it.each([
    [{ responseCode: 451, message: 'private SMTP reply' }, 'smtp_transient'],
    [{ responseCode: 550, message: 'private SMTP reply' }, 'smtp_rejected'],
    [new Error('private network detail'), 'smtp_transient'],
  ])(
    'exposes only a fixed category on transport failure',
    async (error, category) => {
      transport.sendMail.mockRejectedValue(error);
      await expect(
        new SmtpMailer(smtpConfig(settings)).send(message),
      ).rejects.toMatchObject({ message: category, category });
    },
  );

  it('rejects unaccepted deliveries and header injection instead of reporting success', async () => {
    const mailer = new SmtpMailer(smtpConfig(settings));
    transport.sendMail.mockResolvedValue({ accepted: [] });
    await expect(mailer.send(message)).rejects.toMatchObject({
      category: 'smtp_rejected',
    });
    transport.sendMail.mockClear();
    await expect(
      mailer.send({ ...message, subject: 'bad\r\nBcc: injected' }),
    ).rejects.toMatchObject({ category: 'smtp_rejected' });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });

  it('does not construct a transport when disabled', async () => {
    const mailer = new SmtpMailer({ enabled: false });
    expect(transport.createTransport).not.toHaveBeenCalled();
    await expect(mailer.send(message)).rejects.toThrow(/disabled/);
  });
});

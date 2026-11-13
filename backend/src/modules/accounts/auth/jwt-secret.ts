import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const logger = new Logger('AccountsModule');

/**
 * The access-token signing secret, or `undefined` when `JWT_ACCESS_SECRET`
 * isn't configured yet (it reaches `.env.example` through the platform
 * package). Without it the app still starts, but fails closed: no token can
 * be verified, so every protected route answers 401 and public routes treat
 * everyone as a guest. Setting the variable makes logins work, no code change.
 */
export function jwtAccessSecret(config: ConfigService): string | undefined {
  const secret = config.get<string>('JWT_ACCESS_SECRET');
  if (typeof secret !== 'string' || secret.trim() === '') {
    logger.warn(
      'JWT_ACCESS_SECRET is not set: every protected route will answer 401. ' +
        'Add it to backend/.env (generate one with: openssl rand -base64 32).',
    );
    return undefined;
  }
  return secret;
}

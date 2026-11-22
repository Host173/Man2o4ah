import { BadRequestException, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { EmailRecipientLookup } from '../notifications/ports/email-recipient.port.js';
import { EmailRecipientRegistry } from '../notifications/ports/email-recipient.registry.js';
import { User } from './schemas/user.schema.js';

@Injectable()
export class AccountEmailRecipient
  implements EmailRecipientLookup, OnModuleInit
{
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly registry: EmailRecipientRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** GEN-01-B: address only; status does not suppress required notifications. */
  async getRecipient(userId: string) {
    if (!/^[0-9a-f]{24}$/i.test(userId)) {
      throw new BadRequestException({
        code: ErrorCode.ValidationFailed,
        message: 'Invalid email recipient id',
      });
    }
    const user = await this.users.findById(userId).select('email').lean();
    return user ? { userId: user._id.toString(), email: user.email } : null;
  }
}

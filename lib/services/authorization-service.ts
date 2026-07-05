import { AppError } from '@/lib/http/api-errors';

export class AuthorizationService {
  assertUserOwnsResource(userId: string, ownerId: string): void {
    if (userId !== ownerId) {
      throw new AppError('FORBIDDEN', 'You do not have access to this resource.');
    }
  }
}

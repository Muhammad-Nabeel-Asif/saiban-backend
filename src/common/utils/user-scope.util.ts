import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

export function toUserObjectId(userId: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(userId)) {
    throw new BadRequestException('Invalid user id');
  }
  return new Types.ObjectId(userId);
}

export function userScopeFilter(userId: string): { userId: Types.ObjectId } {
  return { userId: toUserObjectId(userId) };
}

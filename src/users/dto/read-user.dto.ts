import { Exclude, Expose } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Role } from '../../common/enums/role.enum';

export class ReadUserDto {
  @ApiProperty({
    description: 'User unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @Expose()
  email: string;

  @ApiProperty({
    description: 'User username',
    example: 'player123',
  })
  @Expose()
  username: string;

  @ApiProperty({
    description: 'User role',
    enum: ['ADMIN', 'PLAYER'],
  })
  @Expose()
  role: Role;

  @ApiPropertyOptional({
    description: 'StarkNet wallet address',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @Expose()
  walletAddress?: string;

  @ApiProperty({
    description: 'Whether the user account is active',
    example: true,
  })
  @Expose()
  isActive: boolean;

  @ApiPropertyOptional({
    description: 'Last login timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  @Expose()
  lastLogin?: Date;

  @ApiProperty({
    description: 'Account creation timestamp',
    example: '2024-01-01T00:00:00Z',
  })
  @Expose()
  createdAt: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2024-01-15T10:30:00Z',
  })
  @Expose()
  updatedAt: Date;

  @ApiProperty({
    description: 'Whether email is verified',
    example: true,
  })
  @Expose()
  readonly isEmailVerified?: boolean;

  @ApiPropertyOptional({
    description: 'User display name',
    example: 'John Doe',
  })
  @Expose() // FIX: Added missing expose parameter hook so mapping transformation engines don't drop fields
  displayName?: string;

  @ApiPropertyOptional({
    description: 'User avatar URL',
    example: 'https://example.com/avatar.jpg',
  })
  @Expose()
  avatarUrl?: string;

  @ApiPropertyOptional({
    description: 'User email preferences',
    example: { promotional: true, transactional: true },
  })
  @Expose()
  emailPreferences?: {
    promotional: boolean;
    transactional: boolean;
  };

  @Exclude()
  password: string;
}

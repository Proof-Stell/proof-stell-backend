import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  Body,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { BadgeService } from './services/badge.service';
import { AchievementService } from './services/achievement.service';
import { CreateBadgeDto } from './dto/create-badge.dto';
import { AwardBadgeDto } from './dto/award-badge.dto';
import {
  BadgeResponseDto,
  UserProfileBadgesDto,
} from './dto/badge-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AchievementType } from './entities/badge.entity';

@ApiTags('Badges')
@Controller('badges')
export class BadgeController {
  constructor(
    private readonly badgeService: BadgeService,
    private readonly achievementService: AchievementService,
  ) {}

  @ApiOperation({ summary: 'Create new badge (Admin only)' })
  @ApiBearerAuth('JWT-auth')
  @ApiBody({ type: CreateBadgeDto })
  @ApiResponse({
    status: 201,
    description: 'Badge created successfully',
    type: BadgeResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin access required',
  })
  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async createBadge(@Body() createBadgeDto: CreateBadgeDto) {
    return await this.badgeService.createBadge(createBadgeDto);
  }

  @ApiOperation({ summary: 'Get all badges' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    description: 'Include inactive badges',
    example: 'false',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Filter by achievement type',
    enum: [
      'GAME_COMPLETION',
      'SCORE_MILESTONE',
      'STREAK',
      'TIME_BASED',
      'SPECIAL',
    ],
  })
  @ApiResponse({
    status: 200,
    description: 'Badges retrieved successfully',
    type: [BadgeResponseDto],
  })
  @Get()
  async getAllBadges(
    @Query('includeInactive') includeInactive?: string,
    @Query('type') type?: AchievementType,
  ) {
    if (type) {
      return await this.badgeService.getBadgesByType(type);
    }
    return await this.badgeService.getAllBadges(includeInactive === 'true');
  }

  @Get('leaderboard')
  async getLeaderboard(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ) {
    return await this.badgeService.getLeaderboardWithBadges(limit);
  }

  @Get(':id')
  async getBadgeById(@Param('id', ParseUUIDPipe) id: string) {
    return await this.badgeService.getBadgeById(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateBadge(
    @Param('id', ParseUUIDPipe) id: string,
    updateData: Partial<CreateBadgeDto>,
  ) {
    return await this.badgeService.updateBadge(id, updateData);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async deactivateBadge(@Param('id', ParseUUIDPipe) id: string) {
    return await this.badgeService.deactivateBadge(id);
  }

  @Post('award')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async awardBadge(awardBadgeDto: AwardBadgeDto, @Request() req) {
    return await this.badgeService.awardBadgeManually(
      awardBadgeDto,
      req.user.id,
    );
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserBadges(@Param('userId', ParseUUIDPipe) userId: string) {
    return await this.badgeService.getUserBadges(userId);
  }

  @Get('user/:userId/profile')
  @UseGuards(JwtAuthGuard)
  async getUserProfileBadges(@Param('userId', ParseUUIDPipe) userId: string) {
    return await this.badgeService.getUserProfileBadges(userId);
  }

  @Get('user/:userId/progress/:badgeId')
  @UseGuards(JwtAuthGuard)
  async getBadgeProgress(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('badgeId', ParseUUIDPipe) badgeId: string,
  ) {
    return await this.badgeService.getBadgeProgress(userId, badgeId);
  }

  @Delete('user/:userId/badge/:badgeId')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async removeBadgeFromUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('badgeId', ParseUUIDPipe) badgeId: string,
  ) {
    return await this.badgeService.removeBadgeFromUser(userId, badgeId);
  }

  @Post('check-achievements/:userId')
  @UseGuards(JwtAuthGuard)
  async checkAchievements(
    @Param('userId', ParseUUIDPipe) userId: string,
    context?: any,
  ) {
    return await this.achievementService.checkAndAwardAchievements(
      userId,
      context,
    );
  }

  @Post('initialize-defaults')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async initializeDefaultBadges() {
    await this.achievementService.initializeDefaultBadges();
    return { message: 'Default badges initialized successfully' };
  }
}

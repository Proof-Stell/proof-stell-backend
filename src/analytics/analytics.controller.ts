import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  HttpStatus,
  HttpCode,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CreateAnalyticsDto } from './dto/create-analytics.dto';
import { AnalyticsEvent } from './analytics-event.enum';
import { AnalyticsAggregationDto } from './dto/analytics-aggregation.dto';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { Request } from 'express';
import { UseInterceptors } from '@nestjs/common';
import { CacheInterceptor } from '../cache/interceptors/cache.interceptor';
import { Cacheable, CacheKeys } from '../cache/decorators/cache.decorator';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @ApiOperation({ summary: 'Log analytics event' })
  @ApiBody({ type: CreateAnalyticsDto })
  @ApiResponse({
    status: 201,
    description: 'Event logged successfully',
  })
  @Post()
  logEvent(@Body() dto: CreateAnalyticsDto) {
    return this.analyticsService.logEvent(dto);
  }

  @ApiOperation({ summary: 'Get all analytics logs' })
  @ApiResponse({
    status: 200,
    description: 'Analytics logs retrieved successfully',
  })
  @Get()
  getAllLogs() {
    return this.analyticsService.getAllLogs();
  }

  @ApiOperation({ summary: 'Get analytics logs for specific user' })
  @ApiQuery({
    name: 'userId',
    description: 'User ID to filter logs',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'User analytics logs retrieved successfully',
  })
  @Get('user')
  getUserLogs(@Query('userId') userId: string) {
    return this.analyticsService.getUserLogs(userId);
  }

  @ApiOperation({ summary: 'Track a single analytics event' })
  @ApiBody({ type: TrackEventDto })
  @ApiResponse({
    status: 201,
    description: 'Event tracked successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        eventId: {
          type: 'string',
          example: '123e4567-e89b-12d3-a456-426614174000',
        },
        message: { type: 'string', example: 'Event tracked successfully' },
      },
    },
  })
  @Post('track')
  @HttpCode(HttpStatus.CREATED)
  async trackEvent(@Body() trackEventDto: TrackEventDto, @Req() req: Request) {
    const event = await this.analyticsService.track(trackEventDto.event, {
      userId: trackEventDto.userId,
      metadata: trackEventDto.metadata,
      sessionId: trackEventDto.sessionId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return {
      success: true,
      eventId: event.id,
      message: 'Event tracked successfully',
    };
  }

  /**
   * Get analytics events with filtering and pagination
   */
  @Get('events')
  // @UseGuards(RolesGuard)
  // @Roles('admin', 'analyst') // Uncomment to restrict access
  async getEvents(@Query() query: AnalyticsQueryDto) {
    const result = await this.analyticsService.getEvents(query);

    return {
      success: true,
      data: result.events,
      pagination: {
        total: result.total,
        limit: query.limit,
        offset: query.offset,
        hasNext: query.offset + query.limit < result.total,
        hasPrev: query.offset > 0,
      },
    };
  }

  /**
   * Get aggregated event counts by time period
   */
  @Get('aggregation')
  // @UseGuards(RolesGuard)
  // @Roles('admin', 'analyst')
  async getEventAggregation(@Query() query: AnalyticsAggregationDto) {
    const aggregation = await this.analyticsService.getEventAggregation(query);

    return {
      success: true,
      data: aggregation,
      groupBy: query.groupBy,
    };
  }

  /**
   * Get top performing events
   */
  @Get('top-events')
  // @UseGuards(RolesGuard)
  // @Roles('admin', 'analyst')
  @UseInterceptors(CacheInterceptor)
  @Cacheable(CacheKeys.ANALYTICS_TOP_EVENTS, 600) // 10 minutes TTL
  async getTopEvents(
    @Query('limit') limit?: number,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const topEvents = await this.analyticsService.getTopEvents(
      limit || 10,
      fromDate,
      toDate,
    );

    return {
      success: true,
      data: topEvents,
    };
  }

  /**
   * Get unique users count
   */
  @Get('unique-users')
  // @UseGuards(RolesGuard)
  // @Roles('admin', 'analyst')
  async getUniqueUsersCount(
    @Query('event') event?: AnalyticsEvent,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    const count = await this.analyticsService.getUniqueUsersCount(
      event,
      fromDate,
      toDate,
    );

    return {
      success: true,
      data: { uniqueUsers: count },
    };
  }

  /**
   * Get analytics dashboard summary
   */
  @Get('dashboard')
  // @UseGuards(RolesGuard)
  // @Roles('admin', 'analyst')
  @UseInterceptors(CacheInterceptor)
  @Cacheable(CacheKeys.ANALYTICS_DASHBOARD, 900) // 15 minutes TTL
  async getDashboard(@Query('days') days?: number) {
    const daysToQuery = days || 30;
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysToQuery);
    const toDate = new Date();

    const [topEvents, uniqueUsers, dailyAggregation] = await Promise.all([
      this.analyticsService.getTopEvents(5, fromDate, toDate),
      this.analyticsService.getUniqueUsersCount(undefined, fromDate, toDate),
      this.analyticsService.getEventAggregation({
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        groupBy: 'day',
      }),
    ]);

    return {
      success: true,
      data: {
        period: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          days: daysToQuery,
        },
        topEvents,
        uniqueUsers,
        dailyActivity: dailyAggregation,
      },
    };
  }

  /**
   * Get available events enum for frontend
   */
  @Get('events-enum')
  getEventsEnum() {
    return {
      success: true,
      data: Object.values(AnalyticsEvent),
    };
  }
}

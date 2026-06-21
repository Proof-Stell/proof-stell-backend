import { Test, TestingModule } from '@nestjs/testing';
import { HttpExceptionFilter } from './http-exception.filter';
import { LoggingService } from '../../logging/logging.service';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let mockLoggingService: any;

  beforeEach(async () => {
    mockLoggingService = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HttpExceptionFilter,
        {
          provide: LoggingService,
          useValue: mockLoggingService,
        },
      ],
    }).compile();

    filter = module.get<HttpExceptionFilter>(HttpExceptionFilter);
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('should handle HTTP exceptions', () => {
    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const mockRequest = {
      method: 'GET',
      url: '/test',
      body: { test: 'data' },
      headers: { 'content-type': 'application/json' },
    };

    const mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;

    const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

    filter.catch(exception, mockHost);

    expect(mockLoggingService.error).toHaveBeenCalledWith(
      'HTTP Exception: GET /test',
      expect.any(Error),
      expect.objectContaining({
        method: 'GET',
        statusCode: 400,
      }),
    );

    expect(mockResponse.status).toHaveBeenCalledWith(400);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 400,
      timestamp: expect.any(String),
      path: '/test',
      message: 'Test error',
    });
  });

  it('should handle generic errors', () => {
    const mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const mockRequest = {
      method: 'POST',
      url: '/api/test',
      body: {},
      headers: {},
    };

    const mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as ArgumentsHost;

    const exception = new Error('Generic error');

    filter.catch(exception, mockHost);

    expect(mockLoggingService.error).toHaveBeenCalledWith(
      'HTTP Exception: POST /api/test',
      expect.any(Error),
      expect.objectContaining({
        method: 'POST',
        statusCode: 500,
      }),
    );

    expect(mockResponse.status).toHaveBeenCalledWith(500);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: 500,
      timestamp: expect.any(String),
      path: '/api/test',
      message: 'Internal server error',
    });
  });
});

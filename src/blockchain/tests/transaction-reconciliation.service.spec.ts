import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionReconciliationService, generateIdempotencyKey } from './services/transaction-reconciliation.service';
import { TransactionStatus, TransactionStatusType } from './entities/transaction-status.entity';
import { BadRequestException } from '@nestjs/common';

describe('TransactionReconciliationService', () => {
  let service: TransactionReconciliationService;
  let repository: Repository<TransactionStatus>;

  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionReconciliationService,
        {
          provide: getRepositoryToken(TransactionStatus),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<TransactionReconciliationService>(
      TransactionReconciliationService,
    );
    repository = module.get<Repository<TransactionStatus>>(
      getRepositoryToken(TransactionStatus),
    );
  });

  describe('generateIdempotencyKey', () => {
    it('should generate a stable key for the same inputs', () => {
      const key1 = generateIdempotencyKey(1, 'mint', 'nonce123');
      const key2 = generateIdempotencyKey(1, 'mint', 'nonce123');
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different inputs', () => {
      const key1 = generateIdempotencyKey(1, 'mint', 'nonce123');
      const key2 = generateIdempotencyKey(2, 'mint', 'nonce123');
      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different operation types', () => {
      const key1 = generateIdempotencyKey(1, 'mint', 'nonce123');
      const key2 = generateIdempotencyKey(1, 'burn', 'nonce123');
      expect(key1).not.toBe(key2);
    });
  });

  describe('checkExistingTransaction', () => {
    it('should return null if no transaction exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const result = await service.checkExistingTransaction('test-key');
      expect(result).toBeNull();
    });

    it('should return existing transaction if found', async () => {
      const mockTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockRepository.findOne.mockResolvedValue(mockTx);
      const result = await service.checkExistingTransaction('test-key');
      expect(result).toEqual(mockTx);
    });
  });

  describe('recordTransactionAttempt', () => {
    it('should create a new transaction record if none exists', async () => {
      mockRepository.findOne.mockResolvedValue(null);
      const mockTx = {
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        requestParameters: { userId: 1 },
      };
      mockRepository.create.mockReturnValue(mockTx);
      mockRepository.save.mockResolvedValue(mockTx);

      const result = await service.recordTransactionAttempt({
        userId: 1,
        operationType: 'mint',
        idempotencyKey: 'test-key',
        requestParameters: { userId: 1 },
      });

      expect(mockRepository.create).toHaveBeenCalledWith({
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        requestParameters: { userId: 1 },
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockTx);
    });

    it('should prevent duplicate submissions of confirmed transactions', async () => {
      const existingTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.CONFIRMED,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: new Date(),
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockRepository.findOne.mockResolvedValue(existingTx);

      const result = await service.recordTransactionAttempt({
        userId: 1,
        operationType: 'mint',
        idempotencyKey: 'test-key',
        requestParameters: { userId: 1 },
      });

      expect(result).toEqual(existingTx);
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should allow retries for pending transactions', async () => {
      const existingTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: null,
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedTx = { ...existingTx, retryCount: 2 };
      mockRepository.findOne.mockResolvedValue(existingTx);
      mockRepository.save.mockResolvedValue(updatedTx);

      const result = await service.recordTransactionAttempt({
        userId: 1,
        operationType: 'mint',
        idempotencyKey: 'test-key',
        requestParameters: { userId: 1 },
      });

      expect(result.retryCount).toBe(2);
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should reset failed transactions to allow retry', async () => {
      const failedTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: null,
        status: TransactionStatusType.FAILED,
        retryCount: 3,
        errorMessage: 'Network error',
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const resetTx = {
        ...failedTx,
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
      };
      mockRepository.findOne.mockResolvedValue(failedTx);
      mockRepository.save.mockResolvedValue(resetTx);

      const result = await service.recordTransactionAttempt({
        userId: 1,
        operationType: 'mint',
        idempotencyKey: 'test-key',
        requestParameters: { userId: 1 },
      });

      expect(result.status).toBe(TransactionStatusType.PENDING);
      expect(result.retryCount).toBe(1);
      expect(result.errorMessage).toBeNull();
    });
  });

  describe('updateTransactionBroadcast', () => {
    it('should update transaction with hash and set to pending', async () => {
      const mockTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: null,
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedTx = {
        ...mockTx,
        transactionHash: '0x123',
        lastReconciledAt: new Date(),
      };
      mockRepository.findOne.mockResolvedValue(mockTx);
      mockRepository.save.mockResolvedValue(updatedTx);

      const result = await service.updateTransactionBroadcast(
        'test-key',
        '0x123',
      );

      expect(result.transactionHash).toBe('0x123');
      expect(result.status).toBe(TransactionStatusType.PENDING);
    });

    it('should throw error if transaction not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateTransactionBroadcast('test-key', '0x123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTransactionConfirmed', () => {
    it('should mark transaction as confirmed', async () => {
      const mockTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const confirmedTx = {
        ...mockTx,
        status: TransactionStatusType.CONFIRMED,
        lastReconciledAt: new Date(),
      };
      mockRepository.findOne.mockResolvedValue(mockTx);
      mockRepository.save.mockResolvedValue(confirmedTx);

      const result = await service.updateTransactionConfirmed('test-key');

      expect(result.status).toBe(TransactionStatusType.CONFIRMED);
      expect(result.errorMessage).toBeNull();
    });

    it('should merge metadata into existing metadata', async () => {
      const mockTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: { blockNumber: 100 },
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updatedTx = {
        ...mockTx,
        status: TransactionStatusType.CONFIRMED,
        metadata: { blockNumber: 100, blockHash: '0xabc' },
      };
      mockRepository.findOne.mockResolvedValue(mockTx);
      mockRepository.save.mockResolvedValue(updatedTx);

      const result = await service.updateTransactionConfirmed('test-key', {
        blockHash: '0xabc',
      });

      expect(result.metadata).toEqual({
        blockNumber: 100,
        blockHash: '0xabc',
      });
    });
  });

  describe('updateTransactionFailed', () => {
    it('should mark transaction as failed with error message', async () => {
      const mockTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const failedTx = {
        ...mockTx,
        status: TransactionStatusType.FAILED,
        errorMessage: 'Network timeout',
        lastReconciledAt: new Date(),
      };
      mockRepository.findOne.mockResolvedValue(mockTx);
      mockRepository.save.mockResolvedValue(failedTx);

      const result = await service.updateTransactionFailed(
        'test-key',
        'Network timeout',
      );

      expect(result.status).toBe(TransactionStatusType.FAILED);
      expect(result.errorMessage).toBe('Network timeout');
    });
  });

  describe('getTransactionsNeedingReconciliation', () => {
    it('should return pending transactions older than max age', async () => {
      const oldDate = new Date(Date.now() - 6 * 60 * 1000); // 6 minutes ago
      const pendingTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.PENDING,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: oldDate,
        requestParameters: null,
        createdAt: oldDate,
        updatedAt: oldDate,
      };
      mockRepository.find.mockResolvedValue([pendingTx]);

      const result = await service.getTransactionsNeedingReconciliation();

      expect(result).toContain(pendingTx);
    });

    it('should return transactions with unknown status', async () => {
      const unknownTx: TransactionStatus = {
        id: 1,
        idempotencyKey: 'test-key',
        userId: 1,
        operationType: 'mint',
        transactionHash: '0x123',
        status: TransactionStatusType.UNKNOWN,
        retryCount: 1,
        errorMessage: null,
        metadata: null,
        lastReconciledAt: null,
        requestParameters: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockRepository.find.mockResolvedValue([unknownTx]);

      const result = await service.getTransactionsNeedingReconciliation();

      expect(result).toContain(unknownTx);
    });
  });
});

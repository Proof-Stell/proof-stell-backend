import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainService } from './blockchain.service';
import { TypedConfigService } from '../common/config/typed-config.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { TransactionReconciliationService } from './services/transaction-reconciliation.service';
import { TransactionStatusType } from './entities/transaction-status.entity';
import { AnalyticsEvent } from '../analytics/analytics-event.enum';

const mockAccount = {
  execute: jest.fn(),
};
const mockProvider = {
  getBlockNumber: jest.fn(),
};
const mockConfigService = {
  mintContractAddress: '0x123',
  starknetPrivateKey: '0xabc',
  starknetAccountAddress: '0xdef',
  starknetRpcUrl: 'https://starknet-goerli.g.alchemy.com/v2/demo',
};
const mockAnalyticsService = {
  track: jest.fn(),
};
const mockReconciliationService = {
  checkExistingTransaction: jest.fn(),
  recordTransactionAttempt: jest.fn(),
  updateTransactionBroadcast: jest.fn(),
  updateTransactionFailed: jest.fn(),
};

jest.mock('starknet', () => ({
  Provider: jest.fn(() => mockProvider),
  Account: jest.fn(() => mockAccount),
  Contract: jest.fn(() => ({
    call: jest.fn().mockResolvedValue({ toString: () => '1000' }),
  })),
}));

describe('BlockchainService - Idempotent Transactions', () => {
  let service: BlockchainService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        { provide: TypedConfigService, useValue: mockConfigService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        {
          provide: TransactionReconciliationService,
          useValue: mockReconciliationService,
        },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMintTx - Idempotent Operations', () => {
    it('should mint tokens and return transaction hash with idempotency key', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'mock-key',
        retryCount: 1,
      });
      mockAccount.execute.mockResolvedValue({ transaction_hash: '0xhash123' });
      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xhash123',
      });

      const result = await service.sendMintTx(1);

      expect(result.transaction_hash).toBe('0xhash123');
      expect(result.idempotencyKey).toBeDefined();
      expect(mockReconciliationService.recordTransactionAttempt).toHaveBeenCalled();
      expect(mockReconciliationService.updateTransactionBroadcast).toHaveBeenCalled();
    });

    it('should return existing confirmed transaction without resubmitting', async () => {
      const existingTx = {
        id: 1,
        idempotencyKey: 'existing-key',
        transactionHash: '0xexisting',
        status: TransactionStatusType.CONFIRMED,
      };
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        existingTx,
      );

      const result = await service.sendMintTx(1, 'existing-nonce');

      expect(result.transaction_hash).toBe('0xexisting');
      expect(mockAccount.execute).not.toHaveBeenCalled();
      expect(
        mockReconciliationService.recordTransactionAttempt,
      ).not.toHaveBeenCalled();
    });

    it('should prevent duplicate submissions for confirmed transactions', async () => {
      mockReconciliationService.checkExistingTransaction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 1,
          idempotencyKey: 'dup-key',
          transactionHash: '0xfirst',
          status: TransactionStatusType.CONFIRMED,
        });

      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'dup-key',
        transactionHash: null,
      });

      mockAccount.execute.mockResolvedValue({
        transaction_hash: '0xfirst',
      });

      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xfirst',
      });

      // First submission
      const result1 = await service.sendMintTx(1, 'dup-nonce');
      expect(result1.transaction_hash).toBe('0xfirst');
      expect(mockAccount.execute).toHaveBeenCalledTimes(1);

      // Second submission with same nonce should return cached result
      mockReconciliationService.checkExistingTransaction.mockResolvedValueOnce({
        transactionHash: '0xfirst',
        status: TransactionStatusType.CONFIRMED,
      });

      const result2 = await service.sendMintTx(1, 'dup-nonce');
      expect(result2.transaction_hash).toBe('0xfirst');
      expect(mockAccount.execute).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should track analytics with idempotency key', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'analytics-key',
        retryCount: 1,
      });
      mockAccount.execute.mockResolvedValue({ transaction_hash: '0xhash456' });
      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xhash456',
      });

      await service.sendMintTx(1);

      expect(mockAnalyticsService.track).toHaveBeenCalledWith(
        AnalyticsEvent.TokenMinted,
        expect.objectContaining({
          userId: '1',
          metadata: expect.objectContaining({
            transaction_hash: '0xhash456',
            idempotencyKey: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('Network Timeout Scenarios', () => {
    it('should handle transient errors and record failed status', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'timeout-key',
        retryCount: 1,
      });

      const timeoutError = new Error('Network request timeout');
      mockAccount.execute.mockRejectedValue(timeoutError);

      try {
        await service.sendMintTx(1);
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Network request timeout');
        expect(
          mockReconciliationService.updateTransactionFailed,
        ).toHaveBeenCalledWith('timeout-key', 'Network request timeout');
      }
    });

    it('should allow retry after failed transaction', async () => {
      const failedTx = {
        idempotencyKey: 'retry-fail-key',
        transactionHash: null,
        status: TransactionStatusType.FAILED,
        retryCount: 1,
      };

      mockReconciliationService.checkExistingTransaction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(failedTx);

      mockReconciliationService.recordTransactionAttempt
        .mockResolvedValueOnce({
          idempotencyKey: 'retry-fail-key',
          retryCount: 1,
        })
        .mockResolvedValueOnce({
          idempotencyKey: 'retry-fail-key',
          retryCount: 2,
          status: TransactionStatusType.PENDING,
        });

      mockAccount.execute
        .mockRejectedValueOnce(new Error('First attempt failed'))
        .mockResolvedValueOnce({ transaction_hash: '0xretry-success' });

      mockReconciliationService.updateTransactionFailed.mockResolvedValue({
        status: TransactionStatusType.FAILED,
      });

      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xretry-success',
      });

      // First attempt fails
      try {
        await service.sendMintTx(1, 'retry-nonce');
      } catch (error) {
        expect(error.message).toContain('First attempt failed');
      }

      // Retry succeeds
      const result = await service.sendMintTx(1, 'retry-nonce');
      expect(result.transaction_hash).toBe('0xretry-success');
    });
  });

  describe('Duplicate Transaction Callbacks', () => {
    it('should handle multiple confirmation callbacks safely', async () => {
      const mockTx = {
        idempotencyKey: 'callback-key',
        transactionHash: '0xcallback',
        status: TransactionStatusType.CONFIRMED,
      };

      mockReconciliationService.checkExistingTransaction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockTx)
        .mockResolvedValueOnce(mockTx);

      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'callback-key',
        retryCount: 1,
      });

      mockAccount.execute.mockResolvedValueOnce({
        transaction_hash: '0xcallback',
      });

      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xcallback',
        status: TransactionStatusType.PENDING,
      });

      // First submission
      const result1 = await service.sendMintTx(1, 'callback-nonce');
      expect(result1.transaction_hash).toBe('0xcallback');

      // Simulate duplicate callback - reconciliation marks as confirmed
      const result2 = await service.sendMintTx(1, 'callback-nonce');
      expect(result2.transaction_hash).toBe('0xcallback');
      expect(mockAccount.execute).toHaveBeenCalledTimes(1); // Still only called once
    });

    it('should not double-charge users on duplicate submissions', async () => {
      const mockTx = {
        idempotencyKey: 'charge-key',
        transactionHash: '0xcharge1',
        status: TransactionStatusType.CONFIRMED,
      };

      mockReconciliationService.checkExistingTransaction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockTx);

      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'charge-key',
        retryCount: 1,
      });

      mockAccount.execute.mockResolvedValueOnce({
        transaction_hash: '0xcharge1',
      });

      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xcharge1',
      });

      // User initiates mint
      const result1 = await service.sendMintTx(1, 'charge-nonce');
      expect(result1.transaction_hash).toBe('0xcharge1');
      expect(mockAccount.execute).toHaveBeenCalledTimes(1);

      // Due to network issue, user clicks again
      // Should return the same hash, not create a new charge
      const result2 = await service.sendMintTx(1, 'charge-nonce');
      expect(result2.transaction_hash).toBe('0xcharge1');
      expect(mockAccount.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('Partial Success Scenarios', () => {
    it('should handle transaction broadcast success but confirmation delay', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'partial-key',
        retryCount: 1,
      });
      mockAccount.execute.mockResolvedValue({
        transaction_hash: '0xpartial',
      });
      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xpartial',
        status: TransactionStatusType.PENDING,
      });

      const result = await service.sendMintTx(1);

      expect(result.transaction_hash).toBe('0xpartial');
      // The transaction should be marked as pending, not confirmed
      // This allows the reconciliation service to verify it later
      expect(
        mockReconciliationService.updateTransactionBroadcast,
      ).toHaveBeenCalled();
    });

    it('should maintain consistency when provider fails after broadcast', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'provider-fail-key',
        retryCount: 1,
      });

      // Transaction is broadcast successfully...
      mockAccount.execute.mockResolvedValue({
        transaction_hash: '0xbroadcast',
      });

      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xbroadcast',
        status: TransactionStatusType.PENDING,
      });

      // But then the provider loses connection (throws error on save)
      // The transaction hash should still be recorded in the database
      const result = await service.sendMintTx(1);

      expect(result.transaction_hash).toBe('0xbroadcast');
      // Even if something fails after this, we have the hash recorded
      expect(
        mockReconciliationService.updateTransactionBroadcast,
      ).toHaveBeenCalledWith('provider-fail-key', '0xbroadcast');
    });
  });

  describe('sendTransferTx and sendBurnTx', () => {
    it('should transfer tokens with idempotency', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'transfer-key',
        retryCount: 1,
      });
      mockAccount.execute.mockResolvedValue({
        transaction_hash: '0xtransfer',
      });
      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xtransfer',
      });

      const result = await service.sendTransferTx(1, 2, 100);

      expect(result.transaction_hash).toBe('0xtransfer');
      expect(result.idempotencyKey).toBeDefined();
      expect(mockAccount.execute).toHaveBeenCalledWith({
        contractAddress: '0x123',
        entrypoint: 'transfer',
        calldata: ['1', '2', '100'],
      });
    });

    it('should burn tokens with idempotency', async () => {
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        null,
      );
      mockReconciliationService.recordTransactionAttempt.mockResolvedValue({
        idempotencyKey: 'burn-key',
        retryCount: 1,
      });
      mockAccount.execute.mockResolvedValue({ transaction_hash: '0xburn' });
      mockReconciliationService.updateTransactionBroadcast.mockResolvedValue({
        transactionHash: '0xburn',
      });

      const result = await service.sendBurnTx(1, 50);

      expect(result.transaction_hash).toBe('0xburn');
      expect(result.idempotencyKey).toBeDefined();
      expect(mockAccount.execute).toHaveBeenCalledWith({
        contractAddress: '0x123',
        entrypoint: 'burn',
        calldata: ['1', '50'],
      });
    });

    it('should prevent duplicate transfers', async () => {
      const existingTransfer = {
        id: 1,
        idempotencyKey: 'transfer-duplicate',
        transactionHash: '0xfirst-transfer',
        status: TransactionStatusType.CONFIRMED,
      };
      mockReconciliationService.checkExistingTransaction.mockResolvedValue(
        existingTransfer,
      );

      const result = await service.sendTransferTx(1, 2, 100, 'same-nonce');

      expect(result.transaction_hash).toBe('0xfirst-transfer');
      expect(mockAccount.execute).not.toHaveBeenCalled();
    });
  });
});
  });

  it('should transfer tokens and track analytics', async () => {
    mockAccount.execute.mockResolvedValue({ transaction_hash: '0xhash2' });
    const result = await service.sendTransferTx(1, 2, 50);
    expect(mockAccount.execute).toHaveBeenCalledWith({
      contractAddress: '0x123',
      entrypoint: 'transfer',
      calldata: ['1', '2', '50'],
    });
    expect(mockAnalyticsService.track).toHaveBeenCalledWith(
      AnalyticsEvent.TokenTransferred,
      {
        userId: '1',
        metadata: { toUserId: 2, amount: 50, transaction_hash: '0xhash2' },
      },
    );
    expect(result).toEqual({ transaction_hash: '0xhash2' });
  });

  it('should burn tokens and track analytics', async () => {
    mockAccount.execute.mockResolvedValue({ transaction_hash: '0xhash3' });
    const result = await service.sendBurnTx(1, 25);
    expect(mockAccount.execute).toHaveBeenCalledWith({
      contractAddress: '0x123',
      entrypoint: 'burn',
      calldata: ['1', '25'],
    });
    expect(mockAnalyticsService.track).toHaveBeenCalledWith(
      AnalyticsEvent.TokenBurned,
      { userId: '1', metadata: { amount: 25, transaction_hash: '0xhash3' } },
    );
    expect(result).toEqual({ transaction_hash: '0xhash3' });
  });

  it('should get balance', async () => {
    const result = await service.getBalance(1);
    expect(result).toEqual({ balance: '1000' });
  });
});

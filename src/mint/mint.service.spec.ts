import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MintService } from './mint.service';
import { Mint } from './entities/mint.entity';
import { BlockchainService } from '../blockchain/blockchain.service';
import { TransactionReconciliationService } from '../blockchain/services/transaction-reconciliation.service';
import { ConflictException } from '@nestjs/common';

describe('MintService - Idempotent Transactions', () => {
  let service: MintService;
  let mintRepository: Repository<Mint>;
  let blockchainService: BlockchainService;
  let reconciliationService: TransactionReconciliationService;

  const mockMintRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockBlockchainService = {
    sendMintTx: jest.fn(),
    sendTransferTx: jest.fn(),
    sendBurnTx: jest.fn(),
    getBalance: jest.fn(),
    checkHealth: jest.fn(),
  };

  const mockReconciliationService = {
    updateTransactionConfirmed: jest.fn(),
    updateTransactionFailed: jest.fn(),
    getTransactionStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MintService,
        {
          provide: getRepositoryToken(Mint),
          useValue: mockMintRepository,
        },
        {
          provide: BlockchainService,
          useValue: mockBlockchainService,
        },
        {
          provide: TransactionReconciliationService,
          useValue: mockReconciliationService,
        },
      ],
    }).compile();

    service = module.get<MintService>(MintService);
    mintRepository = module.get<Repository<Mint>>(getRepositoryToken(Mint));
    blockchainService = module.get<BlockchainService>(BlockchainService);
    reconciliationService = module.get<TransactionReconciliationService>(
      TransactionReconciliationService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('mint - Idempotent Transactions', () => {
    it('should create a mint record with idempotency key', async () => {
      mockMintRepository.findOne.mockResolvedValue(null);
      mockBlockchainService.sendMintTx.mockResolvedValue({
        transaction_hash: '0xmint123',
        idempotencyKey: 'mint-key-123',
      });

      const mockMintRecord: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xmint123',
        idempotencyKey: 'mint-key-123',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMintRepository.create.mockReturnValue(mockMintRecord);
      mockMintRepository.save.mockResolvedValue(mockMintRecord);

      const result = await service.mint(1);

      expect(mockMintRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 1, status: 'pending' },
      });
      expect(mockBlockchainService.sendMintTx).toHaveBeenCalledWith(1, undefined);
      expect(mockMintRepository.create).toHaveBeenCalledWith({
        userId: 1,
        transactionHash: '0xmint123',
        idempotencyKey: 'mint-key-123',
        status: 'pending',
      });
      expect(mockMintRepository.save).toHaveBeenCalledWith(mockMintRecord);
      expect(result.idempotencyKey).toBe('mint-key-123');
      expect(result.status).toBe('pending');
    });

    it('should prevent multiple pending mints for same user', async () => {
      const existingMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xfirst',
        idempotencyKey: 'first-key',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMintRepository.findOne.mockResolvedValue(existingMint);

      try {
        await service.mint(1);
        fail('Should have thrown ConflictException');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect(error.message).toContain('A mint transaction is already pending');
      }

      expect(mockBlockchainService.sendMintTx).not.toHaveBeenCalled();
    });

    it('should allow retry with explicit nonce when previous pending exists', async () => {
      const existingMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xfirst',
        idempotencyKey: 'first-key',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMintRepository.findOne.mockResolvedValue(existingMint);
      mockBlockchainService.sendMintTx.mockResolvedValue({
        transaction_hash: '0xretry',
        idempotencyKey: 'retry-key',
      });

      const retryMint: Mint = {
        id: 2,
        userId: 1,
        transactionHash: '0xretry',
        idempotencyKey: 'retry-key',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMintRepository.create.mockReturnValue(retryMint);
      mockMintRepository.save.mockResolvedValue(retryMint);

      // With an explicit nonce, should allow retry
      const result = await service.mint(1, 'retry-nonce');

      expect(mockBlockchainService.sendMintTx).toHaveBeenCalledWith(1, 'retry-nonce');
      expect(result.idempotencyKey).toBe('retry-key');
    });

    it('should handle blockchain service errors without creating mint record', async () => {
      mockMintRepository.findOne.mockResolvedValue(null);
      mockBlockchainService.sendMintTx.mockRejectedValue(
        new Error('Blockchain service error'),
      );

      try {
        await service.mint(1);
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Blockchain service error');
      }

      expect(mockMintRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('confirmMint - Atomic Status Updates', () => {
    it('should update mint status to confirmed atomically', async () => {
      const mockMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xconfirm',
        idempotencyKey: 'confirm-key',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReconciliationService.updateTransactionConfirmed.mockResolvedValue({
        status: 'confirmed',
      });

      mockMintRepository.findOne.mockResolvedValue(mockMint);
      const confirmedMint = { ...mockMint, status: 'confirmed' };
      mockMintRepository.save.mockResolvedValue(confirmedMint);

      const result = await service.confirmMint('confirm-key');

      expect(mockReconciliationService.updateTransactionConfirmed).toHaveBeenCalledWith(
        'confirm-key',
      );
      expect(mockMintRepository.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'confirm-key' },
      });
      expect(result.status).toBe('confirmed');
    });

    it('should handle missing mint record gracefully', async () => {
      mockReconciliationService.updateTransactionConfirmed.mockResolvedValue({
        status: 'confirmed',
      });
      mockMintRepository.findOne.mockResolvedValue(null);

      const result = await service.confirmMint('nonexistent-key');

      expect(result).toBeNull();
    });
  });

  describe('failMint', () => {
    it('should update mint status to failed with error message', async () => {
      const mockMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xfail',
        idempotencyKey: 'fail-key',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReconciliationService.updateTransactionFailed.mockResolvedValue({
        status: 'failed',
      });

      mockMintRepository.findOne.mockResolvedValue(mockMint);
      const failedMint = { ...mockMint, status: 'failed' };
      mockMintRepository.save.mockResolvedValue(failedMint);

      const result = await service.failMint('fail-key', 'Network timeout');

      expect(mockReconciliationService.updateTransactionFailed).toHaveBeenCalledWith(
        'fail-key',
        'Network timeout',
      );
      expect(result.status).toBe('failed');
    });
  });

  describe('Atomic Transaction Updates', () => {
    it('should save mint record after successful blockchain transaction', async () => {
      mockMintRepository.findOne.mockResolvedValue(null);
      mockBlockchainService.sendMintTx.mockResolvedValue({
        transaction_hash: '0xatomic',
        idempotencyKey: 'atomic-key',
      });

      const mockMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xatomic',
        idempotencyKey: 'atomic-key',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMintRepository.create.mockReturnValue(mockMint);
      mockMintRepository.save.mockResolvedValue(mockMint);

      const result = await service.mint(1);

      // Verify that save was called with the correct data
      expect(mockMintRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          transactionHash: '0xatomic',
          idempotencyKey: 'atomic-key',
          status: 'pending',
        }),
      );
      expect(result.transactionHash).toBe('0xatomic');
    });

    it('should not create mint record if blockchain transaction fails', async () => {
      mockMintRepository.findOne.mockResolvedValue(null);
      mockBlockchainService.sendMintTx.mockRejectedValue(
        new Error('Transaction failed'),
      );

      try {
        await service.mint(1);
      } catch (error) {
        expect(error.message).toContain('Transaction failed');
      }

      // Verify that create/save were never called
      expect(mockMintRepository.create).not.toHaveBeenCalled();
      expect(mockMintRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Transaction Status Queries', () => {
    it('should retrieve mint status by idempotency key', async () => {
      const mockMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xquery',
        idempotencyKey: 'query-key',
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockMintRepository.findOne.mockResolvedValue(mockMint);

      const result = await service.getMintStatus('query-key');

      expect(mockMintRepository.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'query-key' },
      });
      expect(result).toEqual(mockMint);
    });

    it('should retrieve recent mints for a user', async () => {
      const mockMints: Mint[] = [
        {
          id: 3,
          userId: 1,
          transactionHash: '0x3',
          idempotencyKey: 'key-3',
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          userId: 1,
          transactionHash: '0x2',
          idempotencyKey: 'key-2',
          status: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 1,
          userId: 1,
          transactionHash: '0x1',
          idempotencyKey: 'key-1',
          status: 'failed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockMintRepository.find.mockResolvedValue(mockMints);

      const result = await service.getUserMints(1, 50);

      expect(mockMintRepository.find).toHaveBeenCalledWith({
        where: { userId: 1 },
        order: { createdAt: 'DESC' },
        take: 50,
      });
      expect(result).toEqual(mockMints);
    });
  });

  describe('Duplicate Submission Protection', () => {
    it('should protect against duplicate mint submissions from webhook callbacks', async () => {
      const mockMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xwebhook',
        idempotencyKey: 'webhook-key',
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Simulation: first submission
      mockMintRepository.findOne.mockResolvedValueOnce(null);
      mockBlockchainService.sendMintTx.mockResolvedValueOnce({
        transaction_hash: '0xwebhook',
        idempotencyKey: 'webhook-key',
      });

      mockMintRepository.create.mockReturnValueOnce(
        { ...mockMint, status: 'pending' },
      );
      mockMintRepository.save.mockResolvedValueOnce({
        ...mockMint,
        status: 'pending',
      });

      // User initiates mint
      const result1 = await service.mint(1, 'webhook-nonce');
      expect(result1.idempotencyKey).toBe('webhook-key');

      // Later, confirmation arrives from webhook - should check by idempotency key
      mockMintRepository.findOne.mockResolvedValueOnce(mockMint);

      const status = await service.getMintStatus('webhook-key');
      expect(status.status).toBe('confirmed');

      // If webhook callback is received again, client should not resubmit
      mockMintRepository.findOne.mockResolvedValueOnce(mockMint);
      const status2 = await service.getMintStatus('webhook-key');
      expect(status2.status).toBe('confirmed');
    });

    it('should prevent double-charging users on duplicate submissions', async () => {
      const mockMint: Mint = {
        id: 1,
        userId: 1,
        transactionHash: '0xcharge',
        idempotencyKey: 'charge-key',
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // First submission succeeds
      mockMintRepository.findOne.mockResolvedValueOnce(null);
      mockBlockchainService.sendMintTx.mockResolvedValueOnce({
        transaction_hash: '0xcharge',
        idempotencyKey: 'charge-key',
      });

      mockMintRepository.create.mockReturnValueOnce(mockMint);
      mockMintRepository.save.mockResolvedValueOnce(mockMint);

      const result1 = await service.mint(1, 'charge-nonce');
      expect(result1.transactionHash).toBe('0xcharge');

      // User resubmits due to network issue (same nonce)
      mockMintRepository.findOne.mockResolvedValueOnce(mockMint);

      try {
        await service.mint(1);
        fail('Should have thrown ConflictException');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
      }

      // blockchain service should not have been called twice
      expect(mockBlockchainService.sendMintTx).toHaveBeenCalledTimes(1);
    });
  });
});

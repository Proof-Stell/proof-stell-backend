import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WalletNotConnectedException,
  UserRejectedTransactionException,
  NetworkMismatchException,
} from '../exceptions/wallet.exception';
import type {
  WalletProvider,
  WalletConnectionStatus,
  Signature,
  TransactionRequest,
} from '../interfaces/wallet.interface';

/**
 * Mock implementation for Braavos wallet provider.
 * In a real application, this would wrap the actual Braavos SDK.
 * For backend purposes, it simulates receiving data/requests from a frontend
 * that has interacted with Braavos.
 */
@Injectable()
export class BraavosProvider implements WalletProvider {
  readonly name = 'Braavos';
  private readonly logger = new Logger(BraavosProvider.name);
  private isProviderEnabled: boolean;
  private _isConnected = false;
  private _address: string | null = null;
  private _chainId: string | null = null;

  constructor(private configService: ConfigService) {
    this.isProviderEnabled = this.configService.get<boolean>(
      'BRAAVOS_ENABLED',
      false,
    );
    if (this.isProviderEnabled) {
      this.logger.log(`${this.name} provider enabled.`);
    } else {
      this.logger.warn(`${this.name} provider disabled.`);
    }
  }

  isAvailable(): boolean {
    // In a real scenario, this would check if the Braavos extension is detected on the frontend.
    // For backend, we assume it's "available" if enabled in config.
    return this.isProviderEnabled;
  }

  async connect(): Promise<WalletConnectionStatus> {
    if (!this.isProviderEnabled) {
      throw new WalletNotConnectedException(this.name);
    }
    this.logger.log(`Simulating connection for ${this.name}...`);
    // Simulate async connection
    await new Promise((resolve) => setTimeout(resolve, 600));
    this._isConnected = true;
    this._address = '0xBraavosUserAddress'; // Mock address
    this._chainId = '0x1'; // Mock chain ID (e.g., Ethereum Mainnet)
    this.logger.log(
      `${this.name} connected: ${this._address} on chain ${this._chainId}`,
    );
    return {
      isConnected: this._isConnected,
      address: this._address,
      chainId: this._chainId,
      providerName: this.name,
    };
  }

  async disconnect(): Promise<void> {
    this.logger.log(`Simulating disconnection for ${this.name}...`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    this._isConnected = false;
    this._address = null;
    this._chainId = null;
    this.logger.log(`${this.name} disconnected.`);
  }

  async getAccounts(): Promise<string[]> {
    if (!this._isConnected || !this._address) {
      throw new WalletNotConnectedException(this.name);
    }
    return [this._address];
  }

  async getChainId(): Promise<string> {
    if (!this._isConnected || !this._chainId) {
      throw new WalletNotConnectedException(this.name);
    }
    return this._chainId;
  }

  async signMessage(message: string, address: string): Promise<Signature> {
    if (!this._isConnected || this._address !== address) {
      throw new WalletNotConnectedException(this.name);
    }
    this.logger.log(
      `Simulating ${this.name} signing message for ${address}: "${message.substring(0, 20)}..."`,
    );
    // Simulate user rejection 8% of the time
    if (Math.random() < 0.08) {
      throw new UserRejectedTransactionException(
        'Braavos: User declined signature request.',
      );
    }
    // Mock signature
    return {
      r: '0xmockR_braavos',
      s: '0xmockS_braavos',
      v: '27',
      serialized: '0xmockSerializedSignature_braavos',
    };
  }

  async sendTransaction(
    transaction: TransactionRequest,
    address: string,
  ): Promise<{ hash: string }> {
    if (!this._isConnected || this._address !== address) {
      throw new WalletNotConnectedException(this.name);
    }
    if (
      transaction.chainId &&
      transaction.chainId.toString() !== this._chainId
    ) {
      throw new NetworkMismatchException(
        transaction.chainId.toString(),
        this._chainId,
      );
    }

    this.logger.log(
      `Simulating ${this.name} sending transaction from ${address}: ${JSON.stringify(transaction)}`,
    );
    // Simulate user rejection 12% of the time
    if (Math.random() < 0.12) {
      throw new UserRejectedTransactionException(
        'Braavos: Transaction was cancelled by the user.',
      );
    }
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1200));
    // Mock transaction hash
    return { hash: `0x${Math.random().toString(16).substring(2, 12)}` };
  }

  async switchNetwork(chainId: string): Promise<void> {
    if (!this.isProviderEnabled) {
      throw new WalletNotConnectedException(this.name);
    }
    this.logger.log(
      `Simulating ${this.name} switching network to ${chainId}...`,
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    this._chainId = chainId; // Update mock chain ID
    this.logger.log(
      `${this.name} successfully switched to network ${chainId}.`,
    );
  }
}

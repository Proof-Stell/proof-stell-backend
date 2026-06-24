import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MintService } from './mint.service';
import { MintController } from './mint.controller';
import { Mint } from './entities/mint.entity';
import { BlockchainModule } from 'src/blockchain/blockchain.module';

@Module({
  imports: [TypeOrmModule.forFeature([Mint]), BlockchainModule],
  controllers: [MintController],
  providers: [MintService],
})
export class MintModule {}

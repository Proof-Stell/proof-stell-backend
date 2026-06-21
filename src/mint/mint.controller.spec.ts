import { Test, TestingModule } from '@nestjs/testing';
import { MintController } from './mint.controller';
import { MintService } from './mint.service';

describe('MintController', () => {
  let controller: MintController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MintController],
      providers: [{ provide: MintService, useValue: {} }],
    }).compile();

    controller = module.get<MintController>(MintController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

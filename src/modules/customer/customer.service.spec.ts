import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { LedgerService } from '../ledger/ledger.service';
import { CustomerService } from './customer.service';

describe('CustomerService note', () => {
  let service: CustomerService;

  const userId = new Types.ObjectId().toString();
  const customerId = new Types.ObjectId().toString();

  let customerModel: jest.Mock & {
    db: { startSession: jest.Mock };
    findOne: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };

  const customerBalanceAdjustmentModel = {
    findOne: jest.fn(),
  };

  const ledgerService = {
    getCustomerBalance: jest.fn(),
  };

  const createSession = () => ({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    customerModel = Object.assign(jest.fn(), {
      db: { startSession: jest.fn() },
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findOneAndUpdate: jest.fn(),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: getModelToken('Customer'), useValue: customerModel },
        { provide: getModelToken('Order'), useValue: {} },
        { provide: getModelToken('LedgerEntry'), useValue: {} },
        { provide: getModelToken('Payment'), useValue: {} },
        {
          provide: getModelToken('CustomerBalanceAdjustment'),
          useValue: customerBalanceAdjustmentModel,
        },
        { provide: LedgerService, useValue: ledgerService },
      ],
    }).compile();

    service = module.get(CustomerService);
  });

  describe('create', () => {
    it('persists note on the customer and returns it', async () => {
      const session = createSession();
      customerModel.db.startSession.mockResolvedValue(session);

      const savedCustomer = {
        _id: customerId,
        firstName: 'City',
        lastName: 'Pharmacy',
        note: 'Prefers delivery after 5pm.',
        save: jest.fn().mockResolvedValue(undefined),
        toObject: jest.fn().mockReturnValue({
          _id: customerId,
          firstName: 'City',
          lastName: 'Pharmacy',
          note: 'Prefers delivery after 5pm.',
        }),
      };

      customerModel.mockImplementation((payload) => {
        expect(payload.note).toBe('Prefers delivery after 5pm.');
        return savedCustomer;
      });

      const result = await service.create(userId, {
        firstName: 'City',
        lastName: 'Pharmacy',
        note: '  Prefers delivery after 5pm.  ',
      });

      expect(savedCustomer.save).toHaveBeenCalledWith({ session });
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(result.note).toBe('Prefers delivery after 5pm.');
    });
  });

  describe('update', () => {
    it('updates note on the customer', async () => {
      const updatedCustomer = {
        _id: customerId,
        firstName: 'City',
        note: 'Updated: now on 30-day credit terms.',
      };

      customerModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedCustomer),
        }),
      });

      const result = await service.update(userId, customerId, {
        note: 'Updated: now on 30-day credit terms.',
      });

      expect(customerModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: customerId, userId: new Types.ObjectId(userId) },
        { note: 'Updated: now on 30-day credit terms.' },
        { returnDocument: 'after' },
      );
      expect(result.note).toBe('Updated: now on 30-day credit terms.');
    });

    it('clears note when an empty string is sent', async () => {
      const updatedCustomer = {
        _id: customerId,
        firstName: 'City',
        note: '',
      };

      customerModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(updatedCustomer),
        }),
      });

      const result = await service.update(userId, customerId, { note: '' });

      expect(customerModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: customerId, userId: new Types.ObjectId(userId) },
        { note: '' },
        { returnDocument: 'after' },
      );
      expect(result.note).toBe('');
    });

    it('throws when the customer is not found', async () => {
      customerModel.findOneAndUpdate.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      });

      await expect(service.update(userId, customerId, { note: 'New note' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    it('returns note alongside openingBalanceNote', async () => {
      const createdAt = new Date('2026-01-01T10:00:00.000Z');

      customerModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: customerId,
            firstName: 'City',
            note: 'Prefers delivery after 5pm.',
            createdAt,
          }),
        }),
      });

      ledgerService.getCustomerBalance.mockResolvedValue({
        netBalance: '15000.00',
        direction: 'customer_owes',
        absoluteAmount: '15000.00',
      });

      customerBalanceAdjustmentModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue({
                note: 'Carried forward from December 2025 statement',
                createdAt,
              }),
            }),
          }),
        }),
      });

      const result = await service.findOne(userId, customerId);

      expect(result.note).toBe('Prefers delivery after 5pm.');
      expect(result.openingBalanceNote).toBe('Carried forward from December 2025 statement');
      expect(result.balance).toEqual({
        netBalance: '15000.00',
        direction: 'customer_owes',
        absoluteAmount: '15000.00',
      });
    });

    it('returns an empty note for legacy customers without the field', async () => {
      customerModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: customerId,
            firstName: 'City',
            createdAt: new Date('2026-01-01T10:00:00.000Z'),
          }),
        }),
      });

      ledgerService.getCustomerBalance.mockResolvedValue({
        netBalance: '0.00',
        direction: 'settled',
        absoluteAmount: '0.00',
      });

      customerBalanceAdjustmentModel.findOne.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockReturnValue({
              exec: jest.fn().mockResolvedValue(null),
            }),
          }),
        }),
      });

      const result = await service.findOne(userId, customerId);

      expect(result.note).toBe('');
      expect(result.openingBalanceNote).toBeNull();
    });
  });

  describe('findAll', () => {
    it('includes note on each customer in the list', async () => {
      const listQuery = {
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        collation: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { _id: customerId, firstName: 'City', note: 'Important context' },
            { _id: new Types.ObjectId().toString(), firstName: 'Other' },
          ]),
        }),
      };

      customerModel.find.mockReturnValue(listQuery);
      customerModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(2),
      });

      const result = await service.findAll(userId, {});

      expect(result.data).toEqual([
        { _id: customerId, firstName: 'City', note: 'Important context' },
        { _id: expect.any(String), firstName: 'Other', note: '' },
      ]);
    });
  });
});

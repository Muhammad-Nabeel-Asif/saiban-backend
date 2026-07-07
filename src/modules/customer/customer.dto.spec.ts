import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BalanceDirection } from '../../schemas/schema.types';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';

describe('Customer DTO note validation', () => {
  it('accepts an optional note on create', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      firstName: 'City',
      note: '  Prefers delivery after 5pm.  ',
      balanceAdjustment: {
        amount: 15000,
        direction: BalanceDirection.CUSTOMER_OWES,
        note: 'Carried forward from December 2025 statement',
      },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.note).toBe('Prefers delivery after 5pm.');
  });

  it('rejects notes longer than 2000 characters', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      firstName: 'City',
      note: 'a'.repeat(2001),
    });

    const errors = await validate(dto);
    const noteErrors = errors.find((error) => error.property === 'note');

    expect(noteErrors).toBeDefined();
  });

  it('accepts an optional note on update, including empty string', async () => {
    const dto = plainToInstance(UpdateCustomerDto, {
      firstName: 'City',
      note: '',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.note).toBe('');
  });
});

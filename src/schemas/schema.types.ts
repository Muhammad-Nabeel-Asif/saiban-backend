export enum EntryType {
  DEBIT = 'debit', // Sales/Orders
  CREDIT = 'credit', // Payments
}

export enum SourceType {
  ORDER = 'order',
  PAYMENT = 'payment',
  ADJUSTMENT = 'adjustment',
  RETURN = 'return',
}

export enum StockMovementReason {
  ORDER = 'order',
  ADJUSTMENT = 'adjustment',
  RETURN = 'return',
}

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  ON_ACCOUNT = 'on_account',
  CASH = 'cash',
  JAZZCASH = 'jazzcash',
  BANK_TRANSFER = 'bank_transfer',
  CARD = 'card',
  OTHER = 'other',
}

export const PAYMENT_METHOD_OPTIONS = [
  { name: 'On Account', value: PaymentMethod.ON_ACCOUNT },
  { name: 'Cash', value: PaymentMethod.CASH },
  { name: 'JazzCash', value: PaymentMethod.JAZZCASH },
  { name: 'Bank Transfer', value: PaymentMethod.BANK_TRANSFER },
  { name: 'Card', value: PaymentMethod.CARD },
  { name: 'Other', value: PaymentMethod.OTHER },
] as const;

export type PaymentMethodOption = (typeof PAYMENT_METHOD_OPTIONS)[number];

export enum ProductFormulation {
  TABLET = 'tablet',
  SYRUP = 'syrup',
  DROPS = 'drops',
}

export enum PackType {
  TABS = 'tabs',
  ML = 'ml',
  OTHER = 'other',
}

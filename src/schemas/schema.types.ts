export enum EntryType {
  DEBIT = 'debit', // Sales/Orders
  CREDIT = 'credit', // Payments
}

export enum BalanceDirection {
  CUSTOMER_OWES = 'customer_owes',
  WE_OWE_CUSTOMER = 'we_owe_customer',
}

export enum SourceType {
  ORDER = 'order',
  PAYMENT = 'payment',
  ADJUSTMENT = 'adjustment',
  RETURN = 'return',
}

export const SOURCE_TYPE_MODEL_MAP: Record<string, string> = {
  [SourceType.ORDER]: 'Order',
  [SourceType.PAYMENT]: 'Payment',
  [SourceType.ADJUSTMENT]: 'CustomerBalanceAdjustment',
  [SourceType.RETURN]: 'Order',
};

export enum StockMovementReason {
  ORDER = 'order',
  ADJUSTMENT = 'adjustment',
  RETURN = 'return',
}

export enum OrderStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  RETURNED = 'returned',
}

export enum PaymentMethod {
  CASH = 'cash',
  EASYPAISA = 'easypaisa',
  JAZZCASH = 'jazzcash',
  BANK_TRANSFER = 'bank_transfer',
}

export const PAYMENT_METHOD_OPTIONS = [
  { name: 'Cash', value: PaymentMethod.CASH },
  { name: 'EasyPaisa', value: PaymentMethod.EASYPAISA },
  { name: 'JazzCash', value: PaymentMethod.JAZZCASH },
  { name: 'Bank Transfer', value: PaymentMethod.BANK_TRANSFER },
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

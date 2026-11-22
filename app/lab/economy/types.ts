export type EntryType = "expense" | "income";

export type Transaction = {
  id: number;
  description: string;
  merchant: string | null;
  amount: number;
  type: EntryType;
  occurred_on: string;
  created_at: string;
  recurring_item_id: number | null;
  bank_account_id?: number | null;
  external_id?: string | null;
};

export type RecurringItem = {
  id: number;
  name: string;
  amount: number;
  type: EntryType;
  category: string | null;
  expected_until_bank?: boolean;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: number;
  name: string;
  created_at: string;
};

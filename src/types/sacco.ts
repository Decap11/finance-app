export type UserRole = 'member' | 'loan_officer' | 'admin';

export type MemberStatus = 'pending' | 'active' | 'suspended' | 'closed' | 'removed';

export interface UserProfile {
  id: string;
  full_name: string;
  phone?: string | null;
  email: string;
  member_number: string;
  group_id?: string | null;
  role: UserRole;
  status: MemberStatus;
  created_at?: string;
  updated_at?: string;
  shares_target?: number;
  devt_target?: number;
  social_target?: number;
}

export interface SaccoGroup {
  id: string;
  name: string;
  acronym: string;
  group_code: string;
  admin_profile_id?: string | null;
  member_limit?: number | null;
  status: 'active' | 'suspended' | 'closed';
  created_at?: string;
  updated_at?: string;
}

export interface SaccoMembership {
  id: string;
  sacco_id: string;
  profile_id: string;
  role: UserRole;
  status: MemberStatus;
  joined_at?: string;
}

export type AccountType =
  | 'savings'
  | 'shares'
  | 'development_fund'
  | 'social_fund'
  | 'loan';

export interface Account {
  id: string;
  sacco_id: string;
  profile_id: string;
  account_type: AccountType;
  balance: number;
  status: 'active' | 'frozen' | 'closed';
  created_at?: string;
  updated_at?: string;
}

export type TransactionDirection = 'credit' | 'debit';

export type TransactionCategory =
  | 'savings'
  | 'shares'
  | 'development_fund'
  | 'social_fund'
  | 'loan_disbursement'
  | 'loan_repayment'
  | 'fee'
  | 'fine'
  | 'dividend'
  | 'adjustment';

export type TransactionStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'failed'
  | 'reversed';

export interface Transaction {
  id: string;
  sacco_id: string;
  profile_id: string;
  account_id?: string | null;
  loan_id?: string | null;
  amount: number;
  direction: TransactionDirection;
  category: TransactionCategory;
  status: TransactionStatus;
  description?: string | null;
  full_name?: string | null;
  reference?: string | null;
  requested_by?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
}

export type LoanStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'disbursed'
  | 'active'
  | 'completed'
  | 'defaulted'
  | 'cancelled';

export interface LoanRequest {
  id: string;
  sacco_id: string;
  profile_id: string;
  amount_requested: number;
  amount_approved?: number | null;
  outstanding_balance: number;
  interest_rate: number;
  term_months?: number | null;
  purpose?: string | null;
  status: LoanStatus;
  requested_at?: string;
  approved_by?: string | null;
  approved_at?: string | null;
  disbursed_at?: string | null;
  due_date?: string | null;
  closed_at?: string | null;
}

export interface LoanRepayment {
  id: string;
  loan_id: string;
  transaction_id?: string | null;
  amount: number;
  paid_at?: string;
  source_account_id?: string | null;
}

export interface BroadcastMessage {
  id: string;
  sacco_id?: string;
  sender_profile_id?: string;
  sender_name?: string;
  title: string;
  content: string;
  priority?: 'normal' | 'urgent' | 'important';
  created_at: string;
}

export interface RpcResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  sacco_id?: string;
}

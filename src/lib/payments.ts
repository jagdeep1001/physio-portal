import { sessionDateKey } from './datetime';
import type { PaymentAllocation, PaymentMethod, PaymentRecord, TherapySession } from '../types';

export const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'UPI', 'Card', 'Bank transfer', 'Other'];

export type PaymentStatus = 'paid' | 'partial' | 'due' | 'credit' | 'no_charge';

export function normalizeMoney(amount: number | null | undefined): number {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return 0;
  return Math.round(amount);
}

export function sessionFee(session: TherapySession): number {
  return normalizeMoney(session.amountCollected);
}

export function paidForSession(sessionId: string, payments: PaymentRecord[]): number {
  return payments.reduce((sum, payment) => (
    sum + payment.allocations
      .filter((allocation) => allocation.sessionId === sessionId)
      .reduce((inner, allocation) => inner + normalizeMoney(allocation.amount), 0)
  ), 0);
}

export function allocatedTotal(payment: PaymentRecord): number {
  return payment.allocations.reduce((sum, allocation) => sum + normalizeMoney(allocation.amount), 0);
}

export function patientCredit(patientId: string, payments: PaymentRecord[]): number {
  return payments
    .filter((payment) => payment.patientId === patientId)
    .reduce((sum, payment) => sum + normalizeMoney(payment.amount) - allocatedTotal(payment), 0);
}

export function sessionBalance(session: TherapySession, payments: PaymentRecord[]): number {
  return Math.max(0, sessionFee(session) - paidForSession(session.id, payments));
}

export function sessionPaymentStatus(session: TherapySession, payments: PaymentRecord[]): PaymentStatus {
  const fee = sessionFee(session);
  if (fee <= 0) return 'no_charge';
  const paid = paidForSession(session.id, payments);
  if (paid >= fee) return 'paid';
  if (paid > 0) return 'partial';
  return session.status === 'completed' ? 'due' : 'due';
}

export function patientDue(patientId: string, sessions: TherapySession[], payments: PaymentRecord[]): number {
  return sessions
    .filter((session) => session.patientId === patientId && session.status === 'completed')
    .reduce((sum, session) => sum + sessionBalance(session, payments), 0);
}

export function paymentStatusLabel(session: TherapySession, payments: PaymentRecord[]): string {
  const fee = sessionFee(session);
  const paid = paidForSession(session.id, payments);
  const balance = Math.max(0, fee - paid);
  if (fee <= 0) return 'No charge';
  if (paid >= fee) return 'Paid';
  if (paid > 0) return `Partial ${paid}/${fee}`;
  return session.status === 'completed' ? `Due ${balance}` : `Fee ${fee}`;
}

export function allocatePatientCredit(
  patientId: string,
  sessions: TherapySession[],
  payments: PaymentRecord[],
): PaymentRecord[] {
  const orderedSessions = sessions
    .filter((session) => session.patientId === patientId && session.status === 'completed' && sessionFee(session) > 0)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const nextPayments = payments.map((payment) => ({
    ...payment,
    allocations: payment.allocations.map((allocation) => ({ ...allocation })),
  }));

  const patientPayments = nextPayments
    .filter((payment) => payment.patientId === patientId)
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.createdAt.localeCompare(b.createdAt));

  for (const payment of patientPayments) {
    payment.amount = normalizeMoney(payment.amount);
    let remaining = Math.max(0, payment.amount - allocatedTotal(payment));
    if (remaining <= 0) continue;

    for (const session of orderedSessions) {
      const alreadyPaid = paidForSession(session.id, nextPayments);
      const balance = Math.max(0, sessionFee(session) - alreadyPaid);
      if (balance <= 0) continue;
      const applied = normalizeMoney(Math.min(balance, remaining));
      payment.allocations = mergeAllocations(payment.allocations, { sessionId: session.id, amount: applied });
      remaining -= applied;
      if (remaining <= 0) break;
    }
  }

  return nextPayments;
}

export function mergeAllocations(
  allocations: PaymentAllocation[],
  next: PaymentAllocation,
): PaymentAllocation[] {
  const existing = allocations.find((allocation) => allocation.sessionId === next.sessionId);
  if (!existing) return [...allocations, next];
  return allocations.map((allocation) =>
    allocation.sessionId === next.sessionId
      ? { ...allocation, amount: normalizeMoney(allocation.amount + next.amount) }
      : allocation
  );
}

export function buildLegacyPayments(sessions: TherapySession[]): PaymentRecord[] {
  return sessions
    .filter((session) => session.status === 'completed' && session.amountCollected !== null && session.amountCollected > 0)
    .map((session) => ({
      id: `legacy-payment-${session.id}`,
      patientId: session.patientId,
      clinicId: session.clinicId,
      paidAt: session.completedAt ?? session.scheduledAt,
      method: 'Cash' as PaymentMethod,
      notes: 'Legacy session payment',
      amount: sessionFee(session),
      allocations: [{ sessionId: session.id, amount: sessionFee(session) }],
      createdAt: session.completedAt ?? session.scheduledAt,
    }));
}

export function withLegacyPayments(
  sessions: TherapySession[],
  payments: PaymentRecord[],
): PaymentRecord[] {
  const allocatedSessionIds = new Set(
    payments.flatMap((payment) => payment.allocations.map((allocation) => allocation.sessionId))
  );
  return [
    ...payments,
    ...buildLegacyPayments(sessions).filter((payment) => !allocatedSessionIds.has(payment.allocations[0]?.sessionId ?? '')),
  ];
}

export function paymentDateLabel(value: string): string {
  return sessionDateKey(value);
}
